import { createHash, randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
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

/**
 * Test seams. Production code never sets these. `beforeCommit` runs after a
 * JSON file is fully written to its temp name and before it replaces the real
 * file, so a throw there is a deterministic write/commit failure. `afterLock`
 * runs once a story lock is held, before the mutation body.
 */
export const storeTestHooks: {
  beforeCommit?: (path: string) => void;
  afterLock?: (lockPath: string) => void;
  lockTimeoutMs?: number;
} = {};

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 10;

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * Run `fn` while holding the story's exclusive lock (`<story>/.lock`, a
 * directory made atomically with mkdir, so it works across processes). A
 * contender polls until the holder is done; after the timeout it fails with
 * AS-STORE-4 and changes nothing. The lock is always released, including when
 * `fn` throws. If the story folder does not exist yet there is nothing to
 * race on, so `fn` runs unlocked unless `create` is true.
 *
 * A process killed while holding the lock leaves `.lock` behind; the
 * AS-STORE-4 message names it. No automatic crash recovery is promised.
 */
export function withStoryLock<T>(
  paths: WorkPaths,
  fn: () => T,
  options: { create?: boolean } = {},
): T {
  const lock = join(paths.root, ".lock");
  const timeout = storeTestHooks.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  if (options.create === true) mkdirSync(paths.root, { recursive: true });
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return fn();
      if (code !== "EEXIST") {
        throw new CliError(
          "AS-STORE-5",
          `Cannot take the story lock ${lock}: ${(error as Error).message}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new CliError(
          "AS-STORE-4",
          `Another change to this story is in progress (lock ${lock} held for over ${timeout} ms). Nothing was changed; try again.`,
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    storeTestHooks.afterLock?.(lock);
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function commitFile(path: string, text: string, runHook: boolean): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, text);
    if (runHook) storeTestHooks.beforeCommit?.(path);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    if (error instanceof CliError) throw error;
    throw new CliError(
      "AS-STORE-5",
      `Cannot write ${path}: ${(error as Error).message}`,
    );
  }
}

function writeJsonFile(path: string, data: unknown): void {
  commitFile(path, `${JSON.stringify(data, null, 2)}\n`, true);
}

export const readIndex = (paths: WorkPaths): AssetIndex =>
  readJsonFile(paths.index, (d) => indexSchema.parse(d), {});

export const writeIndex = (paths: WorkPaths, index: AssetIndex): void =>
  writeJsonFile(paths.index, indexSchema.parse(index));

export const readNotes = (paths: WorkPaths): Notes =>
  readJsonFile(paths.notes, (d) => notesSchema.parse(d), {});

export const writeNotes = (paths: WorkPaths, notes: Notes): void =>
  writeJsonFile(paths.notes, notesSchema.parse(notes));

/**
 * Write the index and notes together (reject). If the second write fails the
 * first is put back from its previous bytes, so the pair never disagrees; if
 * that restore fails too, AS-STORE-6 says the pair needs a look.
 * Call inside `withStoryLock`.
 */
export function writeIndexAndNotes(
  paths: WorkPaths,
  index: AssetIndex,
  notes: Notes,
): void {
  const before = readFileOrNull(paths.index);
  writeIndex(paths, index);
  try {
    writeNotes(paths, notes);
  } catch (error) {
    try {
      if (before === null) rmSync(paths.index, { force: true });
      else commitFile(paths.index, before, false);
    } catch (restoreError) {
      throw new CliError(
        "AS-STORE-6",
        `Writing ${paths.notes} failed (${(error as Error).message}) and ${paths.index} could not be restored: ${(restoreError as Error).message}`,
      );
    }
    throw error;
  }
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CliError(
      "AS-STORE-3",
      `Cannot read ${path}: ${(error as Error).message}`,
    );
  }
}

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
 * True when the store file exists and its bytes match the hash in its name.
 * False when it is missing. Throws AS-STORE-1 (touching nothing) when it
 * exists but is corrupt, or when the name is not a store file name.
 */
function artifactIsHealthy(
  paths: WorkPaths,
  file: string | null | undefined,
): boolean {
  const match = file == null ? null : /^([0-9a-f]{64})\.[a-z0-9]+$/.exec(file);
  if (file == null || match === null) {
    throw new CliError(
      "AS-STORE-1",
      `Index entry file "${String(file)}" is not a store file name.`,
    );
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(paths.store, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new CliError(
      "AS-STORE-1",
      `Cannot read store file ${file}: ${(error as Error).message}`,
    );
  }
  if (sha256(bytes) !== match[1]) {
    throw new CliError(
      "AS-STORE-1",
      `Store file ${file} exists but its content does not match its name.`,
    );
  }
  return true;
}

/**
 * Record a rendered file as the asset's draft. The same inputs reuse the
 * existing file (after checking it is present and intact) and leave the
 * status alone; a missing file is regenerated as a new draft; a corrupt file
 * is an error and is never overwritten. New inputs store a new file, keep
 * the old one on disk and put the entry back to `draft`.
 */
export function recordDraft(
  paths: WorkPaths,
  draft: DraftInput,
): { entry: IndexEntry; reused: boolean } {
  return withStoryLock(paths, () => recordDraftLocked(paths, draft), {
    create: true,
  });
}

function recordDraftLocked(
  paths: WorkPaths,
  draft: DraftInput,
): { entry: IndexEntry; reused: boolean } {
  const index = readIndex(paths);
  const hash = inputsHash(draft.inputs);
  const current = index[draft.id];
  if (
    current !== undefined &&
    current.inputsHash === hash &&
    artifactIsHealthy(paths, current.file)
  ) {
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
