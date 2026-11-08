import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { derivedIds, type IndexEntry, type Job } from "@asset-studio/formats";

import { CliError } from "../config/errors.js";
import { readIndex, sha256, type WorkPaths } from "../store/store.js";

export const EXPORT_INDEX_FILE = "export-index.json";

export type ExportEntry = {
  kind: string;
  file: string;
  size: NonNullable<IndexEntry["size"]>;
  status: "final" | "draft";
  /** Lines only: from the job. */
  speaker?: string;
  text?: string;
};

export type ExportIndex = {
  schema: 1;
  story: string;
  /** The job's `source` hash, copied unchanged. */
  source: string;
  assets: Record<string, ExportEntry>;
};

type Key = { key: string; id: string; kind: string };

/**
 * The index key of every asset. A picture with 2+ profiles has one key per
 * profile, `<id>~<profile>`; one profile keeps the bare id. Same rule as
 * S5's helper; switch to it once S5 has merged.
 */
export function exportKeys(job: Job): Key[] {
  const pictures = new Map(job.pictures.map((p) => [p.id, p]));
  const out: Key[] = [];
  for (const derived of derivedIds(job)) {
    const picture = pictures.get(derived.id);
    if (picture !== undefined && picture.profiles.length >= 2) {
      for (const profile of picture.profiles) {
        out.push({
          key: `${derived.id}~${profile}`,
          id: derived.id,
          kind: derived.kind,
        });
      }
    } else {
      out.push({ key: derived.id, id: derived.id, kind: derived.kind });
    }
  }
  return out;
}

const STORE_NAME = /^([0-9a-f]{64})\.([a-z0-9]+)$/;

const isInside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
};

/** Real path of `p`, or of its nearest existing ancestor plus the rest. */
function realish(p: string): string {
  const abs = resolve(p);
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const up = dirname(cur);
      if (up === cur) return abs;
      rest.push(basename(cur));
      cur = up;
    }
  }
}

/** True when the folder holds an earlier export: a parsed schema 1 index. */
function isEarlierExport(folder: string): boolean {
  try {
    const doc = JSON.parse(
      readFileSync(join(folder, EXPORT_INDEX_FILE), "utf8"),
    ) as { schema?: unknown };
    return doc.schema === 1;
  } catch {
    // Not readable or not JSON: it is not an earlier export, and the
    // caller refuses the folder with AS-EXPORT-3.
    return false;
  }
}

function checkOutFolder(out: string, paths: WorkPaths, jobPath: string): void {
  const story = realish(paths.root);
  const work = dirname(story);
  const job = realish(jobPath);
  if (isInside(out, work)) {
    throw new CliError(
      "AS-EXPORT-3",
      `The out folder ${out} is inside the work folder; choose a folder elsewhere.`,
    );
  }
  if (isInside(work, out) || isInside(story, out) || isInside(job, out)) {
    throw new CliError(
      "AS-EXPORT-3",
      `The out folder ${out} would contain the job file or the work folder; choose another folder.`,
    );
  }
  if (!existsSync(out)) return;
  if (!statSync(out).isDirectory()) {
    throw new CliError("AS-EXPORT-3", `${out} exists and is not a folder.`);
  }
  if (readdirSync(out).length > 0 && !isEarlierExport(out)) {
    throw new CliError(
      "AS-EXPORT-3",
      `${out} is not empty and is not an earlier export (no valid ${EXPORT_INDEX_FILE} with schema 1); it was left alone.`,
    );
  }
}

export type ExportResult = { exported: number; files: number; out: string };

/**
 * Copy final (and with `drafts`, draft) assets into `out` and write
 * `export-index.json`. The folder is built beside `out` and swapped in only
 * when complete, so a failure leaves a previous export intact.
 */
export function exportJob(
  job: Job,
  paths: WorkPaths,
  jobPath: string,
  outArg: string,
  options: { drafts: boolean },
): ExportResult {
  const out = realish(outArg);
  checkOutFolder(out, paths, jobPath);

  const index = readIndex(paths);
  const soundIds = new Set(job.sounds.map((x) => x.id));
  const lines = new Map(job.lines.map((l) => [l.id, l]));
  const wanted = options.drafts ? ["final", "draft"] : ["final"];
  const assets: Record<string, ExportEntry> = {};
  const copies = new Map<string, string>();

  for (const { key, id, kind } of exportKeys(job)) {
    const entry = index[key];
    if (entry === undefined || !wanted.includes(entry.status)) continue;
    const match = entry.file === null ? null : STORE_NAME.exec(entry.file);
    if (entry.file === null || match === null || entry.size === null) {
      throw new CliError(
        "AS-EXPORT-2",
        `"${key}" is ${entry.status} but its index entry has no valid store file.`,
      );
    }
    if (match[2] === "wav" && !soundIds.has(id)) {
      throw new CliError(
        "AS-EXPORT-2",
        `"${key}" points at a WAV; WAV voice masters are never exported (only a job sound may be a WAV).`,
      );
    }
    const line = lines.get(id);
    assets[key] = {
      kind: entry.kind || kind,
      file: entry.file,
      size: entry.size,
      status: entry.status as "final" | "draft",
      ...(line === undefined ? {} : { speaker: line.speaker, text: line.text }),
    };
    copies.set(entry.file, match[1] as string);
  }

  const doc: ExportIndex = {
    schema: 1,
    story: job.story,
    source: job.source,
    assets,
  };

  const parent = dirname(out);
  mkdirSync(parent, { recursive: true });
  const tag = randomUUID();
  const staging = join(parent, `.${tag}.export-tmp`);
  const backup = join(parent, `.${tag}.export-old`);
  try {
    mkdirSync(staging);
    for (const [file, hash] of copies) {
      const from = join(paths.store, file);
      let bytes: Buffer;
      try {
        bytes = readFileSync(from);
      } catch (error) {
        throw new CliError(
          "AS-EXPORT-2",
          `Cannot read store file ${file}: ${(error as Error).message}`,
        );
      }
      if (sha256(bytes) !== hash) {
        throw new CliError(
          "AS-EXPORT-2",
          `Store file ${file} does not match its name; nothing was exported.`,
        );
      }
      writeFileSync(join(staging, file), bytes);
    }
    writeFileSync(
      join(staging, EXPORT_INDEX_FILE),
      `${JSON.stringify(doc, null, 2)}\n`,
    );
    const hadPrevious = existsSync(out);
    if (hadPrevious) renameSync(out, backup);
    try {
      renameSync(staging, out);
    } catch (error) {
      if (hadPrevious) {
        try {
          renameSync(backup, out);
        } catch (restoreError) {
          throw new CliError(
            "AS-EXPORT-5",
            `Export failed (${(error as Error).message}) and the previous export could not be restored (${(restoreError as Error).message}). It is in ${backup}; move it back to ${out}.`,
          );
        }
      }
      throw error;
    }
    if (hadPrevious) {
      try {
        rmSync(backup, { recursive: true, force: true });
      } catch (cleanError) {
        throw new CliError(
          "AS-EXPORT-6",
          `The new export is in place at ${out}, but the old one could not be deleted (${(cleanError as Error).message}). Delete ${backup} yourself.`,
        );
      }
    }
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (error instanceof CliError) throw error;
    throw new CliError(
      "AS-EXPORT-4",
      `Export failed, the previous export was left as it was: ${(error as Error).message}`,
    );
  }
  return { exported: Object.keys(assets).length, files: copies.size, out };
}
