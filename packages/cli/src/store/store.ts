import { createHash, randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  type AssetIndex,
  type IndexEntry,
  indexSchema,
  type Notes,
  notesSchema,
} from "@asset-studio/formats";

import { CliError } from "../config/errors.js";

export const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

/** Stable JSON: object keys sorted, so equal inputs always hash equal. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `sha256:<hex>` of the inputs that make a file. */
export const inputsHash = (inputs: unknown): string =>
  `sha256:${sha256(canonicalJson(inputs))}`;

export type StoredFile = { file: string; hash: string; created: boolean };

/**
 * Write bytes to `<store>/<sha256>.<ext>` and never overwrite. The same bytes
 * give the same file; a second put is a no-op (`created: false`).
 */
export function putFile(
  storeDir: string,
  data: Uint8Array,
  ext: string,
): StoredFile {
  if (!/^[a-z0-9]+$/.test(ext)) {
    throw new CliError("AS-STORE-2", `Bad file extension "${ext}".`);
  }
  const hash = sha256(data);
  const file = `${hash}.${ext}`;
  const target = join(storeDir, file);
  mkdirSync(storeDir, { recursive: true });
  const tmp = join(storeDir, `.${randomUUID()}.tmp`);
  writeFileSync(tmp, data, { flag: "wx" });
  try {
    // link() fails if the target exists, so an existing file is never replaced.
    linkSync(tmp, target);
    return { file, hash, created: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (sha256(readFileSync(target)) !== hash) {
      throw new CliError(
        "AS-STORE-1",
        `Store file ${file} exists but its content does not match its name.`,
      );
    }
    return { file, hash, created: false };
  } finally {
    unlinkSync(tmp);
  }
}

export type WorkPaths = {
  root: string;
  store: string;
  index: string;
  notes: string;
};

export const workPaths = (workFolder: string, story: string): WorkPaths => {
  const root = join(workFolder, story);
  return {
    root,
    store: join(root, "store"),
    index: join(root, "index.json"),
    notes: join(root, "notes.json"),
  };
};

function readJsonFile<T>(
  path: string,
  parse: (data: unknown) => T,
  empty: T,
): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw new CliError(
      "AS-STORE-3",
      `Cannot read ${path}: ${(error as Error).message}`,
    );
  }
  try {
    return parse(JSON.parse(raw));
  } catch (error) {
    throw new CliError(
      "AS-STORE-3",
      `${path} is not a valid work folder file: ${(error as Error).message}`,
    );
  }
}

function writeJsonFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export const readIndex = (paths: WorkPaths): AssetIndex =>
  readJsonFile(paths.index, (d) => indexSchema.parse(d), {});

export const writeIndex = (paths: WorkPaths, index: AssetIndex): void =>
  writeJsonFile(paths.index, indexSchema.parse(index));

export const readNotes = (paths: WorkPaths): Notes =>
  readJsonFile(paths.notes, (d) => notesSchema.parse(d), {});

export const writeNotes = (paths: WorkPaths, notes: Notes): void =>
  writeJsonFile(paths.notes, notesSchema.parse(notes));

export type DraftInput = {
  id: string;
  kind: string;
  data: Uint8Array;
  ext: string;
  size: NonNullable<IndexEntry["size"]>;
  /** What made the file (provider, prompt, source hashes...). */
  inputs: unknown;
};

/**
 * Record a rendered file as the asset's draft. The same inputs reuse the
 * existing file and leave the status alone; new inputs store a new file, keep
 * the old one on disk and put the entry back to `draft`.
 */
export function recordDraft(
  paths: WorkPaths,
  draft: DraftInput,
): { entry: IndexEntry; reused: boolean } {
  const index = readIndex(paths);
  const hash = inputsHash(draft.inputs);
  const current = index[draft.id];
  if (current !== undefined && current.inputsHash === hash) {
    return { entry: current, reused: true };
  }
  const stored = putFile(paths.store, draft.data, draft.ext);
  const entry: IndexEntry = {
    kind: draft.kind,
    file: stored.file,
    size: draft.size,
    inputsHash: hash,
    status: "draft",
    notes: current?.notes ?? [],
  };
  writeIndex(paths, { ...index, [draft.id]: entry });
  return { entry, reused: false };
}
