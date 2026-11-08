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

/** An index key: the job's asset ID, or `<id>~<profile>` when the asset has 2+ profiles. */
export type AssetKey = DerivedId & {
  /** The index key. */
  key: string;
  /** The job's asset ID (what the key was derived from). */
  assetId: string;
  /** The profile this key renders, when the asset has profiles. */
  profile?: string;
};

/**
 * The index key of one profile of a picture (or glow mask): bare `id` when
 * the asset has one profile, `<id>~<profile>` when it has two or more.
 */
export function profileKey(
  id: string,
  profiles: readonly string[],
  profile: string,
): string {
  return profiles.length >= 2 ? `${id}~${profile}` : id;
}

/**
 * Every index key the job implies: `derivedIds` with each picture, and the
 * glow mask of a picture, expanded to one key per profile when it has 2 or
 * more (Bob's ruling, 2026-11-08). Mood stills keep `portrait.<speaker>~<mood>`.
 */
export function assetKeys(job: Job): AssetKey[] {
  const profilesOf = new Map<string, string[]>();
  for (const picture of job.pictures) {
    const profiles = [...new Set(picture.profiles)];
    profilesOf.set(picture.id, profiles);
    const dot = picture.id.indexOf(".");
    if (picture.glow === true && dot !== -1) {
      profilesOf.set(`glow.${picture.id.slice(dot + 1)}`, profiles);
    }
  }
  const out: AssetKey[] = [];
  for (const derived of derivedIds(job)) {
    const profiles = profilesOf.get(derived.id);
    if (profiles === undefined || profiles.length < 2) {
      out.push({
        ...derived,
        key: derived.id,
        assetId: derived.id,
        ...(profiles?.[0] === undefined ? {} : { profile: profiles[0] }),
      });
      continue;
    }
    for (const profile of profiles) {
      out.push({
        ...derived,
        id: `${derived.id}~${profile}`,
        key: `${derived.id}~${profile}`,
        assetId: derived.id,
        profile,
      });
    }
  }
  return out;
}

/** Every derived ID with its status from the index (`missing` if absent). */
export function computeNeeds(job: Job, paths: WorkPaths): Need[] {
  const index = readIndex(paths);
  return assetKeys(job).map(({ key, kind, origin }) => ({
    id: key,
    kind,
    origin,
    status: index[key]?.status ?? "missing",
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
  if (!assetKeys(job).some((asset) => asset.key === id)) {
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
  withStoryLock(
    paths,
    () => {
      const { index, entry } = requireDecidable(job, paths, id);
      writeIndex(paths, { ...index, [id]: { ...entry, status: "final" } });
    },
    { whenMissing: () => void requireDecidable(job, paths, id) },
  );
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
  const lockedReject = () => {
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
  };
  withStoryLock(paths, lockedReject, {
    whenMissing: () => void requireDecidable(job, paths, id),
  });
}
