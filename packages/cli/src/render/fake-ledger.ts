// The fake ledger: <work>/<story>/fake.json lists every asset key a fake run
// (ASSET_STUDIO_FAKE_PROVIDERS=1) stored, so placeholder media can never be
// mistaken for real work. The index schema is not changed.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { CliError } from "../config/errors.js";
import {
  readIndex,
  type WorkPaths,
  withStoryLock,
  writeIndex,
} from "../store/store.js";

export const ledgerPath = (paths: WorkPaths): string =>
  join(paths.root, "fake.json");

export function readLedger(paths: WorkPaths): string[] {
  let raw: string;
  try {
    raw = readFileSync(ledgerPath(paths), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new CliError(
      "AS-STORE-3",
      `Cannot read ${ledgerPath(paths)}: ${(error as Error).message}`,
    );
  }
  try {
    const data = JSON.parse(raw) as { keys?: unknown };
    if (
      !Array.isArray(data.keys) ||
      !data.keys.every((k) => typeof k === "string")
    ) {
      throw new Error("expected { keys: string[] }");
    }
    return data.keys as string[];
  } catch (error) {
    throw new CliError(
      "AS-STORE-3",
      `${ledgerPath(paths)} is not a valid work folder file: ${(error as Error).message}`,
    );
  }
}

/** Call inside the story lock. Temp file, then rename. */
function writeLedger(paths: WorkPaths, keys: readonly string[]): void {
  const path = ledgerPath(paths);
  if (keys.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(
    tmp,
    `${JSON.stringify({ keys: [...keys].sort() }, null, 2)}\n`,
  );
  renameSync(tmp, path);
}

/**
 * Before a fake run: refuse (AS-FAKE-2) if the story holds anything real.
 * Returns the index as it was, to find what the run changed.
 */
export function beginFakeRun(
  paths: WorkPaths,
  story: string,
): Record<string, string> {
  if (!existsSync(paths.root)) return {};
  return withStoryLock(paths, () => {
    const index = readIndex(paths);
    const ledger = new Set(readLedger(paths));
    if (Object.keys(index).some((k) => !ledger.has(k))) {
      throw new CliError(
        "AS-FAKE-2",
        `story "${story}" already holds real assets; fake providers would overwrite real work. Use a separate work folder (--work-folder) for fake runs.`,
      );
    }
    return Object.fromEntries(
      Object.entries(index).map(([k, v]) => [k, JSON.stringify(v)]),
    );
  });
}

/** After a fake run: list every key the run added or changed. */
export function endFakeRun(
  paths: WorkPaths,
  before: Record<string, string>,
): void {
  if (!existsSync(paths.root)) return;
  withStoryLock(paths, () => {
    const keys = new Set(readLedger(paths));
    for (const [k, v] of Object.entries(readIndex(paths))) {
      if (before[k] !== JSON.stringify(v)) keys.add(k);
    }
    writeLedger(paths, [...keys]);
  });
}

/**
 * Before a real run: forget the placeholder entries, so every renderer sees
 * those keys as missing. The ledger goes with them.
 */
export function dropFakeEntries(paths: WorkPaths): string[] {
  if (!existsSync(ledgerPath(paths))) return [];
  return withStoryLock(paths, () => {
    const keys = readLedger(paths);
    const index = readIndex(paths);
    const kept = Object.fromEntries(
      Object.entries(index).filter(([k]) => !keys.includes(k)),
    );
    writeIndex(paths, kept);
    writeLedger(paths, []);
    return keys;
  });
}
