import { statSync } from "node:fs";
import { join } from "node:path";

import type { AssetStatus, IndexEntry, Job } from "@asset-studio/formats";

import { type AssetKey, assetKeys, glowOf } from "./keys.js";
import type { Library } from "./library.js";

export type Size = { width: number; height: number } | { seconds: number };

export type ReviewRow = {
  key: string;
  id: string;
  kind: string;
  profile: string | null;
  status: AssetStatus;
  /** Store file name; null while missing. */
  file: string | null;
  /** What the index records; null when unavailable (never shown as zero). */
  size: Size | null;
  /** The size the job declares for this picture or still; null when none. */
  declared: { width: number; height: number } | null;
  notes: string[];
  speaker: string | null;
  /** The line's text exactly as the job has it. */
  caption: string | null;
  media: "image" | "audio" | null;
  mediaUrl: string | null;
  /** The store file is missing from disk. */
  mediaError: { code: string; message: string } | null;
  /** For a glow mask: the painting it overlays. */
  overlay: { key: string; mediaUrl: string | null } | null;
};

export type Review = {
  story: string;
  jobPath: string;
  statuses: readonly AssetStatus[];
  rows: ReviewRow[];
};

const IMAGE = new Set(["webp", "png", "jpg", "jpeg"]);
const AUDIO = new Set(["m4a", "wav", "mp3"]);

export const mediaType = (file: string): "image" | "audio" | null => {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE.has(ext) ? "image" : AUDIO.has(ext) ? "audio" : null;
};

const MEDIA_FILE = /^[0-9a-f]{64}\.[a-z0-9]+$/;

export const mediaUrl = (story: string, file: string): string =>
  `/media/${story}/${file}`;

export function buildReview(
  lib: Library,
  workFolder: string,
  job: Job,
  jobPath: string,
): Review {
  const paths = lib.workPaths(workFolder, job.story);
  const index = lib.readIndex(paths);
  const keys = assetKeys(job, new Set(Object.keys(index)));
  const lines = new Map(job.lines.map((l) => [l.id, l]));
  const rowsByKey = new Map<string, ReviewRow>();
  const rows = keys.map((k) => {
    const row = buildRow(job, k, index[k.key], lines, paths.store);
    rowsByKey.set(k.key, row);
    return row;
  });
  for (const row of rows) {
    if (row.kind !== "glow") continue;
    const painting = job.pictures.find((p) => glowOf(p.id) === row.id);
    if (painting === undefined) continue;
    const owner =
      row.profile !== null && painting.profiles.length >= 2
        ? `${painting.id}~${row.profile}`
        : painting.id;
    const target = rowsByKey.get(owner);
    row.overlay = { key: owner, mediaUrl: target?.mediaUrl ?? null };
  }
  return {
    story: job.story,
    jobPath,
    statuses: ["missing", "draft", "final", "rejected"],
    rows,
  };
}

function buildRow(
  job: Job,
  k: AssetKey,
  entry: IndexEntry | undefined,
  lines: Map<string, Job["lines"][number]>,
  storeDir: string,
): ReviewRow {
  const file = entry?.file ?? null;
  const line = k.kind === "line" ? lines.get(k.id) : undefined;
  const profileName =
    k.kind === "portrait" ? "portrait" : (k.profile ?? undefined);
  const dims =
    profileName === undefined ? undefined : job.profiles[profileName];
  let media: ReviewRow["media"] = null;
  let url: string | null = null;
  let mediaError: ReviewRow["mediaError"] = null;
  if (file !== null) {
    media = mediaType(file);
    if (!MEDIA_FILE.test(file)) {
      mediaError = {
        code: "AS-STORE-1",
        message: `Index entry file "${file}" is not a store file name.`,
      };
    } else {
      url = mediaUrl(job.story, file);
      try {
        statSync(join(storeDir, file));
      } catch (error) {
        mediaError = {
          code: "AS-STUDIO-3",
          message: `Store file ${file} cannot be read: ${(error as Error).message}`,
        };
      }
    }
  }
  return {
    key: k.key,
    id: k.id,
    kind: k.kind,
    profile: k.profile,
    status: entry?.status ?? "missing",
    file,
    size: entry?.size ?? null,
    declared:
      dims === undefined ? null : { width: dims.width, height: dims.height },
    notes: entry?.notes ?? [],
    speaker: line?.speaker ?? null,
    caption: line?.text ?? null,
    media,
    mediaUrl: url,
    mediaError,
    overlay: null,
  };
}
