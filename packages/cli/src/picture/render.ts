import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";

import type { Job } from "@asset-studio/formats";

import type { CommandContext } from "../bin/registry.js";
import { CliError } from "../config/errors.js";
import { glowMasterPath, maskWebp, readMask } from "../glow/glow.js";
import { assetKeys, profileKey } from "../needs/needs.js";
import {
  type Renderer,
  type RenderJob,
  registerRenderer,
  resolveJobPath,
} from "../render/registry.js";
import { recordDraft, sha256, type WorkPaths } from "../store/store.js";
import { coverWebp, type Dimensions, imageSize } from "./images.js";

/** Where masters live: `<work>/<story>/masters`. `WorkPaths` has no field for it. */
export const mastersDir = (paths: WorkPaths): string =>
  join(paths.root, "masters");

type Outcome = { rendered: number; failed: number };

/** Run one asset; log its failure with the ID and code and keep going. */
async function guard(
  ctx: CommandContext,
  id: string,
  outcome: Outcome,
  work: () => Promise<boolean>,
): Promise<boolean> {
  try {
    const ok = await work();
    if (ok) outcome.rendered += 1;
    return ok;
  } catch (error) {
    outcome.failed += 1;
    if (error instanceof CliError) {
      ctx.stderr(`${error.code}: ${error.message}\n`);
      for (const line of error.extraLines) ctx.stderr(`${line}\n`);
    } else {
      ctx.stderr(
        `AS-PICTURE-9: ${id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return false;
  }
}

/** Read a job-declared source. An empty path is AS-PICTURE-4, an unreadable file AS-PICTURE-1. */
function readSource(where: RenderJob, id: string, source: string): Buffer {
  if (source.trim() === "") {
    throw new CliError("AS-PICTURE-4", `${id}: the source path is empty.`);
  }
  const path = resolveJobPath(where.jobDir, source);
  try {
    return readFileSync(path);
  } catch (error) {
    throw new CliError(
      "AS-PICTURE-1",
      `${id}: cannot read source ${path}: ${(error as Error).message}`,
    );
  }
}

/**
 * Keep the original as the master at `masters/<id>.<ext>`, byte for byte (never
 * re-encoded). Written temp-then-rename so a partial copy cannot stick. If a
 * master is already there with other bytes (the source changed, or the file
 * is damaged), it is kept as `masters/<id>.<first 8 hex of its sha256>.<ext>`
 * and the new one takes its place; one line is logged.
 */
function keepMaster(
  ctx: CommandContext,
  paths: WorkPaths,
  id: string,
  source: string,
  bytes: Buffer,
): void {
  const ext = extname(source).slice(1).toLowerCase() || "bin";
  const dir = mastersDir(paths);
  const target = join(dir, `${id}.${ext}`);
  try {
    mkdirSync(dir, { recursive: true });
    let old: Buffer | undefined;
    try {
      old = readFileSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (old?.equals(bytes) === true) return;
    const tmp = join(dir, `.${randomUUID()}.tmp`);
    writeFileSync(tmp, bytes, { flag: "wx" });
    try {
      if (old !== undefined) {
        const archive = join(dir, `${id}.${sha256(old).slice(0, 8)}.${ext}`);
        if (!existsSync(archive)) renameSync(target, archive);
        ctx.stdout(
          `${id}: source changed; kept the old master as ${basename(archive)}\n`,
        );
      }
      renameSync(tmp, target);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      "AS-PICTURE-3",
      `${id}: cannot keep master ${basename(target)}: ${(error as Error).message}`,
    );
  }
}

type StillJob = {
  key: string;
  kind: string;
  target: Dimensions;
  profile: string;
};

/** Render one source to one profile and record it as a draft. */
async function renderOne(
  paths: WorkPaths,
  job: StillJob,
  bytes: Buffer,
  sourceSize: Dimensions,
): Promise<void> {
  const data = await coverWebp(bytes, job.target);
  recordDraft(paths, {
    id: job.key,
    kind: job.kind,
    data,
    ext: "webp",
    size: job.target,
    inputs: {
      renderer: "picture",
      version: 1,
      source: sha256(bytes),
      sourceSize,
      width: job.target.width,
      height: job.target.height,
      profile: job.profile,
    },
  });
}

async function renderPictures(
  ctx: CommandContext,
  job: Job,
  paths: WorkPaths,
  where: RenderJob,
  outcome: Outcome,
): Promise<void> {
  for (const picture of job.pictures) {
    if (picture.source === undefined) continue; // prompt only: stays missing for AI mode
    const profiles = [...new Set(picture.profiles)];
    let bytes: Buffer;
    let sourceSize: Dimensions;
    try {
      bytes = readSource(where, picture.id, picture.source);
      sourceSize = await imageSize(bytes).catch((error: unknown) => {
        throw new CliError(
          "AS-PICTURE-1",
          `${picture.id}: source ${picture.source} is not a readable image: ${(error as Error).message}`,
        );
      });
      keepMaster(ctx, paths, picture.id, picture.source, bytes);
    } catch (error) {
      // The source cannot be used: one failure for the picture, logged with its ID.
      await guard(ctx, picture.id, outcome, async () => {
        throw error;
      });
      if (picture.glow === true && picture.id.includes(".")) {
        const glowId = `glow.${picture.id.slice(picture.id.indexOf(".") + 1)}`;
        for (const profile of profiles) {
          const key = profileKey(glowId, profiles, profile);
          await guard(ctx, key, outcome, async () => {
            throw new CliError(
              "AS-GLOW-6",
              `${key}: skipped because the source of ${picture.id} failed.`,
            );
          });
        }
      }
      continue;
    }

    for (const profile of profiles) {
      const key = profileKey(picture.id, profiles, profile);
      const target = job.profiles[profile];
      await guard(ctx, key, outcome, async () => {
        if (target === undefined) {
          throw new CliError(
            "AS-PICTURE-2",
            `${key}: unknown profile "${profile}".`,
          );
        }
        await renderOne(
          paths,
          { key, kind: picture.kind, target, profile },
          bytes,
          sourceSize,
        );
        return true;
      });
    }

    if (picture.glow === true) {
      await renderGlow(ctx, job, paths, outcome, {
        pictureId: picture.id,
        profiles,
        sourceSize,
      });
    }
  }
}

async function renderGlow(
  ctx: CommandContext,
  job: Job,
  paths: WorkPaths,
  outcome: Outcome,
  p: { pictureId: string; profiles: string[]; sourceSize: Dimensions },
): Promise<void> {
  const dot = p.pictureId.indexOf(".");
  if (dot === -1) return;
  const glowId = `glow.${p.pictureId.slice(dot + 1)}`;
  const path = glowMasterPath(mastersDir(paths), glowId);
  let mask: Awaited<ReturnType<typeof readMask>> | undefined;
  let maskError: unknown;
  try {
    mask = await readMask(glowId, path, { id: p.pictureId, ...p.sourceSize });
  } catch (error) {
    maskError = error;
  }
  for (const profile of p.profiles) {
    const key = profileKey(glowId, p.profiles, profile);
    await guard(ctx, key, outcome, async () => {
      if (mask === undefined) throw maskError;
      const target = job.profiles[profile];
      if (target === undefined) {
        throw new CliError(
          "AS-GLOW-5",
          `${key}: unknown profile "${profile}".`,
        );
      }
      const data = await maskWebp(mask.bytes, target);
      recordDraft(paths, {
        id: key,
        kind: "glow",
        data,
        ext: "webp",
        size: target,
        inputs: {
          renderer: "glow",
          version: 1,
          mask: sha256(mask.bytes),
          paintingSize: p.sourceSize,
          width: target.width,
          height: target.height,
          profile,
        },
      });
      return true;
    });
  }
}

async function renderStills(
  ctx: CommandContext,
  job: Job,
  paths: WorkPaths,
  where: RenderJob,
  outcome: Outcome,
): Promise<void> {
  for (const member of job.cast) {
    // No requested moods: no still, no ID, nothing stored.
    if (member.moods.length === 0) continue;
    for (const mood of new Set(member.moods)) {
      const id =
        mood === "neutral"
          ? `portrait.${member.id}`
          : `portrait.${member.id}~${mood}`;
      const source = member.portraits?.find((p) => p.mood === mood)?.source;
      if (source === undefined) continue; // no source: stays missing, never invented
      await guard(ctx, id, outcome, async () => {
        const target = job.profiles.portrait;
        if (target === undefined) {
          throw new CliError(
            "AS-PICTURE-2",
            `${id}: the job has no "portrait" profile.`,
          );
        }
        const bytes = readSource(where, id, source);
        const sourceSize = await imageSize(bytes).catch((error: unknown) => {
          throw new CliError(
            "AS-PICTURE-1",
            `${id}: source ${source} is not a readable image: ${(error as Error).message}`,
          );
        });
        keepMaster(ctx, paths, id, source, bytes);
        await renderOne(
          paths,
          { key: id, kind: "portrait", target, profile: "portrait" },
          bytes,
          sourceSize,
        );
        return true;
      });
    }
  }
}

export const pictureRenderer: Renderer = {
  kind: "picture",
  async render(ctx, job, paths, where) {
    // Fails closed (AS-ID-3) before anything is written.
    assetKeys(job);
    const outcome: Outcome = { rendered: 0, failed: 0 };
    await renderPictures(ctx, job, paths, where, outcome);
    await renderStills(ctx, job, paths, where, outcome);
    return outcome;
  },
};

registerRenderer(pictureRenderer);
