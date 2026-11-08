import { readFileSync } from "node:fs";

import {
  type AssetStatus,
  type DerivedId,
  derivedIds,
  type IndexEntry,
  type Job,
  jobSchema,
} from "@asset-studio/formats";

import { CliError, EXIT_USAGE } from "../config/errors.js";
import {
  readIndex,
  readNotes,
  type WorkPaths,
  withStoryLock,
  writeIndex,
  writeIndexAndNotes,
} from "../store/store.js";

export function loadJob(path: string): Job {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new CliError(
      "AS-JOB-1",
      `Cannot read job ${path}: ${(error as Error).message}`,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new CliError("AS-JOB-1", `Job ${path} is not valid JSON.`);
  }
  const result = jobSchema.safeParse(data);
  if (!result.success) {
    throw new CliError(
      "AS-JOB-2",
      `Job ${path} is not a valid asset job.`,
      1,
      result.error.issues.map(
        (issue) => `  ${issue.path.join(".") || "(job)"}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}

export type Need = DerivedId & { status: AssetStatus };

/** Every derived ID with its status from the index (`missing` if absent). */
export function computeNeeds(job: Job, paths: WorkPaths): Need[] {
  const index = readIndex(paths);
  return derivedIds(job).map((derived) => ({
    ...derived,
    status: index[derived.id]?.status ?? "missing",
  }));
}

export function formatNeeds(needs: readonly Need[]): string {
  if (needs.length === 0) return "";
  const idWidth = Math.max(...needs.map((n) => n.id.length));
  const kindWidth = Math.max(...needs.map((n) => n.kind.length));
  const rows = needs.map(
    (n) => `${n.id.padEnd(idWidth)}  ${n.kind.padEnd(kindWidth)}  ${n.status}`,
  );
  return `${rows.join("\n")}\n`;
}

function requireDecidable(job: Job, paths: WorkPaths, id: string) {
  if (!derivedIds(job).some((derived) => derived.id === id)) {
    throw new CliError("AS-ID-1", `"${id}" is not an asset ID in this job.`);
  }
  const index = readIndex(paths);
  const entry = index[id];
  if (entry === undefined || entry.status === "missing") {
    throw new CliError(
      "AS-ID-2",
      `"${id}" has no file yet (status missing); render it first.`,
    );
  }
  return { index, entry };
}

/** Set `final`. Only this and `reject` can. */
export function approve(job: Job, paths: WorkPaths, id: string): void {
  withStoryLock(paths, () => {
    const { index, entry } = requireDecidable(job, paths, id);
    writeIndex(paths, { ...index, [id]: { ...entry, status: "final" } });
  });
}

/** Set `rejected`; the note goes to the entry and to `notes.json`. */
export function reject(
  job: Job,
  paths: WorkPaths,
  id: string,
  note: string,
): void {
  const text = note.trim();
  if (text === "") {
    throw new CliError(
      "AS-USAGE-1",
      "reject needs a non-empty --note.",
      EXIT_USAGE,
    );
  }
  withStoryLock(paths, () => {
    const { index, entry } = requireDecidable(job, paths, id);
    const notes = readNotes(paths);
    const rejected: IndexEntry = {
      ...entry,
      status: "rejected",
      notes: [...entry.notes, text],
    };
    writeIndexAndNotes(
      paths,
      { ...index, [id]: rejected },
      { ...notes, [id]: [...(notes[id] ?? []), text] },
    );
  });
}
