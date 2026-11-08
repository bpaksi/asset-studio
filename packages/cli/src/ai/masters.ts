// AI-made masters live in `masters/ai/`, a folder S5 never reads, so an AI
// mask can never be mistaken for a hand-placed `masters/glow.<entry>.png`.
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import type { CommandContext } from "../bin/registry.js";
import { mastersDir } from "../picture/render.js";
import { sha256, type WorkPaths } from "../store/store.js";

export const aiMastersDir = (paths: WorkPaths): string =>
  join(mastersDir(paths), "ai");

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\~]/g, "\\$&");

/** Current masters named `<id>.<ext>` in a folder (not `<id>.<hash8>.<ext>` archives). */
function currentIn(dir: string, id: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const re = new RegExp(`^${escapeRe(id)}\\.[a-z0-9]+$`);
  return names.filter((n) => re.test(n)).map((n) => join(dir, n));
}

/**
 * The current master of an ID: the AI one if there is one, else S5's. If a
 * folder holds more than one (a format change in S5's folder), the newest
 * file wins, ties by name, so the pick never depends on directory order.
 */
export function currentMaster(
  paths: WorkPaths,
  id: string,
): string | undefined {
  for (const dir of [aiMastersDir(paths), mastersDir(paths)]) {
    const found = currentIn(dir, id)
      .map((p) => ({ p, t: statSync(p).mtimeMs }))
      .sort((a, b) => b.t - a.t || (a.p < b.p ? -1 : 1));
    if (found[0] !== undefined) return found[0].p;
  }
  return undefined;
}

/** Is there an AI-made master for this ID (so the mask is AI-made, not hand-placed)? */
export const hasAiMaster = (paths: WorkPaths, id: string): boolean =>
  currentIn(aiMastersDir(paths), id).length > 0;

/**
 * Keep the bytes as `masters/ai/<id>.<ext>`. Any other current master of the
 * ID (same bytes in another format, or older bytes) is first kept as
 * `<id>.<first 8 hex of its sha256>.<ext>`, one line logged, so a redo never
 * loses the previous master and exactly one current master remains.
 */
export function keepAiMaster(
  ctx: CommandContext,
  paths: WorkPaths,
  id: string,
  ext: string,
  bytes: Buffer,
): void {
  const dir = aiMastersDir(paths);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${id}.${ext}`);
  const olds = currentIn(dir, id);
  if (olds.length === 1 && olds[0] === target) {
    if (readFileSync(target).equals(bytes)) return;
  }
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(tmp, bytes, { flag: "wx" });
  try {
    for (const old of olds) {
      const oldBytes = readFileSync(old);
      const oldExt = basename(old).slice(id.length + 1);
      const archive = join(
        dir,
        `${id}.${sha256(oldBytes).slice(0, 8)}.${oldExt}`,
      );
      if (existsSync(archive)) rmSync(old);
      else renameSync(old, archive);
      ctx.stdout(
        `${id}: kept the previous AI master as ${basename(archive)}\n`,
      );
    }
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
