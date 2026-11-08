// AI mode (P2 S6): `render --ai` fills every still-missing picture, mood still
// and glow mask as a draft. Never final, never a talking mouth, never a
// final or rejected asset. Runs after S5's source renderer.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Job } from "@asset-studio/formats";
import sharp from "sharp";

import { CliError } from "../config/errors.js";
import { maskWebp } from "../glow/glow.js";
import { assetKeys, profileKey } from "../needs/needs.js";
import {
  coverWebp,
  type Dimensions,
  decodeRgb,
  imageSize,
} from "../picture/images.js";
import {
  type Renderer,
  type RenderOutcome,
  registerRenderer,
  resolveJobPath,
} from "../render/registry.js";
import {
  readIndex,
  readNotes,
  recordDraft,
  sha256,
  type WorkPaths,
  withStoryLock,
  writeNotes,
} from "../store/store.js";
import { geminiImageFromEnv } from "./gemini.js";
import { currentMaster, hasAiMaster, keepAiMaster } from "./masters.js";
import type { ImageInput, ImageProvider, ImageRequest } from "./provider.js";

type Env = Readonly<Record<string, string | undefined>>;

export type AiDeps = { provider(env: Env): ImageProvider };

export const defaultAiDeps = (): AiDeps => ({
  provider: (env) => geminiImageFromEnv(env),
});

/** Remove the secret from text before it can reach a log or a file. */
const redactor = (env: Env) => {
  const key = env.GEMINI_API_KEY;
  return (text: string): string =>
    key === undefined || key === "" ? text : text.split(key).join("[redacted]");
};

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\~]/g, "\\$&");

const extOf = (format: string | undefined): string =>
  format === "jpeg" ? "jpg" : (format ?? "bin");

type Unit = {
  kind: ImageRequest["kind"];
  /** The job's asset ID. */
  id: string;
  /** Index keys still missing (one per profile when the asset has 2+). */
  keys: { key: string; profile: string }[];
  /** A mask remade because its AI painting was: skipped if that painting failed. */
  follows?: string;
  prompt?: string;
  references: string[];
  subject?: { name: string; mood: string };
};

/**
 * An asset AI mode makes: `missing`, or `rejected` with a pending redo note.
 * `draft` and `final` are never remade, and a rejected asset with no note stays rejected.
 */
const wanted = (
  index: ReturnType<typeof readIndex>,
  notes: ReturnType<typeof readNotes>,
  key: string,
): boolean => {
  const status = index[key]?.status ?? "missing";
  return (
    status === "missing" ||
    (status === "rejected" && (notes[key]?.length ?? 0) > 0)
  );
};

function planUnits(
  paths: WorkPaths,
  job: Job,
  index: ReturnType<typeof readIndex>,
  pending: ReturnType<typeof readNotes>,
): Unit[] {
  const units: Unit[] = [];
  const styleRefs = job.style?.references ?? [];

  for (const member of job.cast) {
    if (member.moods.length === 0) continue;
    for (const mood of new Set(member.moods)) {
      const id =
        mood === "neutral"
          ? `portrait.${member.id}`
          : `portrait.${member.id}~${mood}`;
      const portrait = member.portraits?.find((p) => p.mood === mood);
      if (portrait?.source !== undefined) continue; // S5's, never invented here
      if (!wanted(index, pending, id)) continue;
      const unit: Unit = {
        kind: "still",
        id,
        keys: [{ key: id, profile: "portrait" }],
        references: [...styleRefs, ...(member.references ?? [])],
        subject: { name: member.name, mood },
      };
      if (portrait?.prompt !== undefined) unit.prompt = portrait.prompt;
      units.push(unit);
    }
  }

  for (const picture of job.pictures) {
    const profiles = [...new Set(picture.profiles)];
    const missing = (id: string) =>
      profiles
        .map((profile) => ({
          key: profileKey(id, profiles, profile),
          profile,
        }))
        .filter(({ key }) => wanted(index, pending, key));
    const keys = missing(picture.id);
    if (picture.source === undefined && keys.length > 0) {
      const unit: Unit = {
        kind: "picture",
        id: picture.id,
        keys,
        references: [...styleRefs],
      };
      if (picture.prompt !== undefined) unit.prompt = picture.prompt;
      units.push(unit);
    }
    const paintingRedone = picture.source === undefined && keys.length > 0;
    const dot = picture.id.indexOf(".");
    if (picture.glow === true && dot !== -1) {
      const glowId = `glow.${picture.id.slice(dot + 1)}`;
      let maskKeys = missing(glowId);
      let follows: string | undefined;
      // A redone painting also remakes its AI-made mask (never a hand-placed one,
      // never a final one) so the two stay aligned.
      if (paintingRedone && hasAiMaster(paths, glowId)) {
        follows = picture.id;
        maskKeys = profiles
          .map((profile) => ({
            key: profileKey(glowId, profiles, profile),
            profile,
          }))
          .filter(({ key }) => index[key]?.status !== "final");
      }
      if (maskKeys.length > 0) {
        const unit: Unit = {
          kind: "mask",
          id: glowId,
          keys: maskKeys,
          references: [],
        };
        if (follows !== undefined) unit.follows = follows;
        units.push(unit);
      }
    }
  }
  return units;
}

/** Where a mask's painting comes from: the picture whose glow it is. */
const paintingIdOf = (job: Job, glowId: string): string | undefined =>
  job.pictures.find(
    (p) =>
      p.glow === true &&
      p.id.includes(".") &&
      `glow.${p.id.slice(p.id.indexOf(".") + 1)}` === glowId,
  )?.id;

function readReferences(
  jobDir: string,
  id: string,
  names: readonly string[],
): ImageInput[] {
  return names.map((name) => {
    const path = resolveJobPath(jobDir, name);
    try {
      return { name, bytes: readFileSync(path) };
    } catch (error) {
      throw new CliError(
        "AS-AI-3",
        `${id}: cannot read reference ${path}: ${(error as Error).message}`,
      );
    }
  });
}

/** Remove the notes that were sent, once the draft is committed. */
function clearNotes(
  paths: WorkPaths,
  sent: ReadonlyMap<string, readonly string[]>,
): void {
  if (![...sent.values()].some((n) => n.length > 0)) return;
  withStoryLock(paths, () => {
    const notes = { ...readNotes(paths) };
    for (const [key, list] of sent) {
      const current = notes[key];
      if (current === undefined || list.length === 0) continue;
      // Only a head that equals what was sent is removed; notes added since stay.
      if (!list.every((n, i) => current[i] === n)) continue;
      const kept = current.slice(list.length);
      if (kept.length === 0) delete notes[key];
      else notes[key] = kept;
    }
    writeNotes(paths, notes);
  });
}

export function createAiRenderer(deps: AiDeps = defaultAiDeps()): Renderer {
  return {
    kind: "picture",
    ai: true,
    async render(ctx, job, paths, where): Promise<RenderOutcome> {
      assetKeys(job); // fails closed (AS-ID-3) before anything is written
      const redact = redactor(ctx.env);
      const outcome: RenderOutcome = { rendered: 0, failed: 0 };
      const units = planUnits(paths, job, readIndex(paths), readNotes(paths));
      if (units.length === 0) return outcome;
      // A missing key (AS-AI-1) is thrown to `render`, which logs it and counts it.
      const provider = deps.provider(ctx.env);

      const fail = (id: string, error: unknown): void => {
        outcome.failed += 1;
        const code = error instanceof CliError ? error.code : "AS-AI-9";
        const text = redact(
          error instanceof Error ? error.message : String(error),
        );
        const message = text.startsWith(`${id}:`) ? text : `${id}: ${text}`;
        ctx.stderr(`${code}: ${message}\n`);
        if (error instanceof CliError) {
          for (const line of error.extraLines) ctx.stderr(`${redact(line)}\n`);
        }
      };
      const failedPictures = new Set<string>();

      for (const unit of units) {
        if (unit.follows !== undefined && failedPictures.has(unit.follows)) {
          continue; // its painting failed and was logged; the old pair stays
        }
        try {
          await runUnit(unit);
        } catch (error) {
          if (unit.kind === "picture") failedPictures.add(unit.id);
          fail(unit.id, error);
        }
      }
      return outcome;

      async function runUnit(unit: Unit): Promise<void> {
        const stored = readNotes(paths);
        const sent = new Map<string, string[]>(
          unit.keys.map(({ key }) => [key, [...(stored[key] ?? [])]]),
        );
        const notes = [...sent.values()].flat();
        const style = job.style?.picture;

        // The size to ask for, and for a mask the painting it lights.
        let size: Dimensions;
        let painting: Buffer | undefined;
        if (unit.kind === "mask") {
          const paintingId = paintingIdOf(job, unit.id);
          const path =
            paintingId === undefined
              ? undefined
              : currentMaster(paths, paintingId);
          if (path === undefined) {
            throw new CliError(
              "AS-AI-8",
              `${unit.id}: the painting ${paintingId ?? "?"} has no master to light yet, so no mask was asked for.`,
            );
          }
          painting = readFileSync(path);
          size = await imageSize(painting).catch((error: unknown) => {
            throw new CliError(
              "AS-AI-8",
              `${unit.id}: the painting master ${path} is not a readable image: ${(error as Error).message}`,
            );
          });
        } else {
          const profiles = unit.keys.map(({ profile }) => {
            const target = job.profiles[profile];
            if (target === undefined) {
              throw new CliError(
                "AS-AI-2",
                `${unit.id}: unknown profile "${profile}".`,
              );
            }
            return target;
          });
          size = profiles.reduce((a, b) =>
            b.width * b.height > a.width * a.height ? b : a,
          );
        }

        const request: ImageRequest = {
          kind: unit.kind,
          id: unit.id,
          references: readReferences(where.jobDir, unit.id, unit.references),
          notes,
          size: { ...size },
        };
        if (unit.prompt !== undefined) request.prompt = unit.prompt;
        if (style !== undefined && unit.kind !== "mask") request.style = style;
        if (unit.subject !== undefined) request.subject = { ...unit.subject };
        if (painting !== undefined) request.painting = painting;

        let image: Uint8Array;
        try {
          image = (await provider.generate(request)).image;
        } catch (error) {
          throw new CliError(
            "AS-AI-4",
            `${unit.id}: the image request failed: ${redact(error instanceof Error ? error.message : String(error))}`,
          );
        }
        const bytes = Buffer.from(image);

        // Check the output before anything is stored.
        let decoded: Dimensions;
        let format: string | undefined;
        try {
          if (bytes.length === 0) throw new Error("the image is empty");
          decoded = await imageSize(bytes);
          format = (await sharp(bytes).metadata()).format;
        } catch (error) {
          throw new CliError(
            "AS-AI-5",
            `${unit.id}: the provider returned something that is not a readable image: ${(error as Error).message}`,
          );
        }

        ctx.stdout(
          `${unit.id}: provider returned ${decoded.width}x${decoded.height} (${format ?? "?"})\n`,
        );
        const refHashes = request.references.map((r) => sha256(r.bytes));
        const base = {
          renderer: "ai",
          version: 1,
          provider: provider.id,
          model: provider.model ?? null,
          kind: unit.kind,
          prompt: unit.prompt ?? null,
          style: request.style ?? null,
          references: refHashes,
        };

        if (unit.kind === "mask") {
          const pixels = await decodeRgb(bytes);
          if (decoded.width !== size.width || decoded.height !== size.height) {
            throw new CliError(
              "AS-AI-6",
              `${unit.id}: the mask is ${decoded.width}x${decoded.height} but the painting is ${size.width}x${size.height}.`,
            );
          }
          for (let i = 0; i + 2 < pixels.data.length; i += 3) {
            if (
              pixels.data[i] !== pixels.data[i + 1] ||
              pixels.data[i] !== pixels.data[i + 2]
            ) {
              const px = i / 3;
              throw new CliError(
                "AS-AI-7",
                `${unit.id}: the mask is not greyscale (pixel ${px % size.width},${Math.floor(px / size.width)} is not R=G=B).`,
              );
            }
          }
          // Kept as the PNG master a hand-placed mask would be (same path S5 reads).
          const png =
            format === "png" ? bytes : await sharp(bytes).png().toBuffer();
          keepAiMaster(ctx, paths, unit.id, "png", png);
          for (const { key, profile } of unit.keys) {
            await commit(key, sent, async () => {
              const target = job.profiles[profile];
              if (target === undefined) {
                throw new CliError(
                  "AS-AI-2",
                  `${key}: unknown profile "${profile}".`,
                );
              }
              recordDraft(paths, {
                id: key,
                kind: "glow",
                data: await maskWebp(png, target),
                ext: "webp",
                size: target,
                inputs: {
                  ...base,
                  painting: sha256(painting ?? ""),
                  notes: sent.get(key) ?? [],
                  width: target.width,
                  height: target.height,
                  profile,
                },
              });
            });
          }
          return;
        }

        keepAiMaster(ctx, paths, unit.id, extOf(format), bytes);
        const kindOfIndex =
          unit.kind === "still"
            ? "portrait"
            : (job.pictures.find((p) => p.id === unit.id)?.kind ?? "picture");
        for (const { key, profile } of unit.keys) {
          await commit(key, sent, async () => {
            const target = job.profiles[profile];
            if (target === undefined) {
              throw new CliError(
                "AS-AI-2",
                `${key}: unknown profile "${profile}".`,
              );
            }
            recordDraft(paths, {
              id: key,
              kind: kindOfIndex,
              data: await coverWebp(bytes, target),
              ext: "webp",
              size: target,
              inputs: {
                ...base,
                notes: sent.get(key) ?? [],
                width: target.width,
                height: target.height,
                profile,
              },
            });
          });
        }
      }

      /** Store one key's draft, then clear the notes that went into it. */
      async function commit(
        key: string,
        sent: ReadonlyMap<string, readonly string[]>,
        store: () => Promise<void>,
      ): Promise<void> {
        try {
          await store();
          outcome.rendered += 1;
        } catch (error) {
          fail(key, error);
          return; // the note stays for the next try
        }
        try {
          clearNotes(paths, new Map([[key, sent.get(key) ?? []]]));
        } catch (error) {
          fail(key, error);
        }
      }
    },
  };
}

registerRenderer(createAiRenderer());
