// Test support only (not shipped): builds a temp work folder from the committed
// fixture job and the committed tiny media, and hashes folders to prove that
// looking and failing change nothing.
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { indexSchema } from "@asset-studio/formats";

const FIXTURES = fileURLToPath(
  new URL("../../test-fixtures/", import.meta.url),
);
export const MEDIA = join(FIXTURES, "media");
export const JOB_FIXTURE = join(FIXTURES, "asset-job.json");

export const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

export type Workspace = {
  root: string;
  /** The work folder. */
  work: string;
  /** Settings folder for ASSET_STUDIO_CONFIG_DIR. */
  cfg: string;
  jobPath: string;
  env: Record<string, string>;
  storeDir: string;
  indexPath: string;
  /** Copy a media fixture (or bytes) into the story store; returns its store file name. */
  put(source: string | Uint8Array, ext: string): string;
  cleanup(): void;
};

const readMedia = (name: string) => readFileSync(join(MEDIA, name));

export type Seed = Record<
  string,
  {
    kind: string;
    media: string;
    size: { width: number; height: number } | { seconds: number };
    status: "draft" | "final" | "rejected";
    notes?: string[];
  }
>;

/** The fixture's start state (review-cases.json), with two profile keys for foe.shade. */
export const START: Seed = {
  "scene-a.02~vo-01": {
    kind: "line",
    media: "line.m4a",
    size: { seconds: 1.11 },
    status: "draft",
  },
  "painting.stair": {
    kind: "painting",
    media: "painting-stair.webp",
    size: { width: 1920, height: 1080 },
    status: "draft",
  },
  "glow.stair": {
    kind: "glow",
    media: "glow-stair.webp",
    size: { width: 1920, height: 1080 },
    status: "draft",
  },
  "portrait.narrator~angry": {
    kind: "portrait",
    media: "portrait-narrator-angry.webp",
    size: { width: 720, height: 900 },
    status: "draft",
  },
  "foe.shade~dashboard": {
    kind: "foe",
    media: "foe-shade-dashboard.webp",
    size: { width: 1920, height: 1080 },
    status: "final",
  },
  "foe.shade~ipad": {
    kind: "foe",
    media: "foe-shade-ipad.webp",
    size: { width: 1640, height: 2360 },
    status: "final",
  },
  "sound.door": {
    kind: "effect",
    media: "door.wav",
    size: { seconds: 0.2 },
    status: "final",
  },
  "portrait.narrator": {
    kind: "portrait",
    media: "portrait-narrator-angry.webp",
    size: { width: 720, height: 900 },
    status: "rejected",
    notes: ["less anger"],
  },
};

export function buildWorkspace(seed: Seed = START): Workspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "as-studio-")));
  const work = join(root, "work");
  const cfg = join(root, "cfg");
  const story = join(work, "fixture-story");
  const storeDir = join(story, "store");
  mkdirSync(storeDir, { recursive: true });
  mkdirSync(join(story, "masters"), { recursive: true });
  writeFileSync(join(story, "masters", "glow.stair.png"), "master-bytes");
  mkdirSync(cfg, { recursive: true });
  const jobPath = join(root, "asset-job.json");
  cpSync(JOB_FIXTURE, jobPath);

  const put = (source: string | Uint8Array, ext: string): string => {
    const bytes = typeof source === "string" ? readMedia(source) : source;
    const file = `${sha256(bytes)}.${ext}`;
    writeFileSync(join(storeDir, file), bytes);
    return file;
  };

  const index: Record<string, unknown> = {};
  for (const [key, e] of Object.entries(seed)) {
    index[key] = {
      kind: e.kind,
      file: put(e.media, e.media.slice(e.media.lastIndexOf(".") + 1)),
      size: e.size,
      inputsHash: `sha256:${sha256(key)}`,
      status: e.status,
      notes: e.notes ?? [],
    };
  }
  const indexPath = join(story, "index.json");
  writeFileSync(
    indexPath,
    `${JSON.stringify(indexSchema.parse(index), null, 2)}\n`,
  );
  const rejected = Object.entries(seed).filter(([, e]) => e.notes?.length);
  writeFileSync(
    join(story, "notes.json"),
    `${JSON.stringify(Object.fromEntries(rejected.map(([k, e]) => [k, e.notes])), null, 2)}\n`,
  );

  // A second story the studio must never touch.
  const other = join(work, "other-story");
  mkdirSync(join(other, "store"), { recursive: true });
  writeFileSync(join(other, "index.json"), "{}\n");
  writeFileSync(join(other, "store", "keep.txt"), "unrelated");

  return {
    root,
    work,
    cfg,
    jobPath,
    env: { ASSET_STUDIO_CONFIG_DIR: cfg },
    storeDir,
    indexPath,
    put,
    cleanup: () => {
      // A test may have made the story folder read-only.
      chmodSync(story, 0o755);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** sha256 of every file under `dir`, keyed by relative path. */
export function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out[relative(dir, path)] = sha256(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}
