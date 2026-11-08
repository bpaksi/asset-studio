import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "@asset-studio/formats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../bin/cli.js";
import { approve } from "../needs/needs.js";
import {
  putFile,
  readIndex,
  recordDraft,
  sha256,
  workPaths,
  writeIndex,
} from "../store/store.js";

const SOURCE = `sha256:${"b".repeat(64)}`;

const makeJob = (): Job => ({
  schema: 1,
  story: "dracula",
  source: SOURCE,
  profiles: {
    board: { width: 8, height: 4 },
    ipad: { width: 4, height: 2 },
  },
  cast: [
    {
      id: "count",
      name: "The Count",
      voice: { provider: "gemini-tts", voiceId: "Charon" },
      moods: ["neutral"],
    },
  ],
  lines: [
    { id: "n1-house.02~vo-01", speaker: "count", text: "Come in, late." },
  ],
  pictures: [
    {
      id: "painting.n1-house",
      kind: "painting",
      profiles: ["board"],
      prompt: "a stair",
      glow: true,
    },
    {
      id: "foe.shade",
      kind: "foe",
      profiles: ["board", "ipad"],
      prompt: "a shade",
    },
  ],
  moments: [],
  sounds: [{ id: "sound.door", kind: "effect", source: "sfx/door.wav" }],
});

let dir: string;
let work: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "as-export-")));
  work = join(dir, "w");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const paths = () => workPaths(work, "dracula");

const draft = (id: string, kind: string, ext: string, bytes: string) => {
  const isAudio = ext === "m4a";
  recordDraft(paths(), {
    id,
    kind,
    data: new TextEncoder().encode(bytes),
    ext,
    size: isAudio ? { seconds: 1.5 } : { width: 8, height: 4 },
    inputs: { id, bytes },
  });
};

const jobPath = () => join(dir, "asset-job.json");
const writeJob = (job: Job = makeJob()) =>
  writeFileSync(jobPath(), JSON.stringify(job));

const cli = async (args: string[]) => {
  let out = "";
  let err = "";
  const code = await main(["--work-folder", work, ...args], {
    env: { ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg") },
    cwd: dir,
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
  });
  return { code, out, err };
};

const readExport = (folder: string) =>
  JSON.parse(readFileSync(join(folder, "export-index.json"), "utf8")) as {
    source: string;
    assets: Record<string, Record<string, unknown>>;
  };

const listing = (folder: string) => readdirSync(folder).sort();

/**
 * approve/reject know only bare IDs until S5's key expansion merges, so a
 * per-profile key gets its status straight in the index (test setup only).
 */
const setStatus = (key: string, status: "final" | "rejected") => {
  const index = readIndex(paths());
  const entry = index[key];
  if (entry === undefined) throw new Error(`no entry ${key}`);
  writeIndex(paths(), { ...index, [key]: { ...entry, status } });
};

/** line final, painting final, glow draft, foe~board rejected, sound draft. */
function seed() {
  const job = makeJob();
  writeJob(job);
  draft("n1-house.02~vo-01", "line", "m4a", "voice");
  draft("painting.n1-house", "painting", "webp", "paint");
  draft("glow.n1-house", "glow", "webp", "glow");
  draft("foe.shade~board", "foe", "webp", "foe-board");
  draft("sound.door", "effect", "m4a", "door");
  approve(job, paths(), "n1-house.02~vo-01");
  approve(job, paths(), "painting.n1-house");
  setStatus("foe.shade~board", "rejected");
  // masters and a caption record sit beside the store and must never ship
  mkdirSync(join(paths().root, "masters"), { recursive: true });
  writeFileSync(join(paths().root, "masters", "n1-house.02~vo-01.wav"), "RIFF");
  mkdirSync(join(paths().root, "captions"), { recursive: true });
  writeFileSync(join(paths().root, "captions", "x.json"), "{}");
  return job;
}

describe("export", () => {
  it("exports exactly the final set, with the source hash and no extras", async () => {
    seed();
    const out = join(dir, "out");
    const r = await cli(["export", jobPath(), "--out", out]);
    expect(r.code).toBe(0);
    const doc = readExport(out);
    expect(Object.keys(doc.assets).sort()).toEqual([
      "n1-house.02~vo-01",
      "painting.n1-house",
    ]);
    expect(doc.source).toBe(SOURCE);
    const idx = readIndex(paths());
    const files = [
      idx["n1-house.02~vo-01"]?.file,
      idx["painting.n1-house"]?.file,
    ] as string[];
    expect(listing(out)).toEqual([...files, "export-index.json"].sort());
    // file name hash and extension match the bytes
    for (const f of files) {
      expect(f).toBe(
        `${sha256(readFileSync(join(out, f)))}.${f.split(".")[1]}`,
      );
    }
    expect(doc.assets["painting.n1-house"]).toMatchObject({
      kind: "painting",
      status: "final",
      size: { width: 8, height: 4 },
    });
  });

  it("never exports rejected or missing, masters, WAVs, captions, notes", async () => {
    seed();
    const out = join(dir, "out");
    await cli(["export", jobPath(), "--out", out, "--drafts"]);
    const doc = readExport(out);
    // rejected
    expect(doc.assets["foe.shade~board"]).toBeUndefined();
    // missing (no file ever rendered)
    expect(doc.assets["foe.shade~ipad"]).toBeUndefined();
    const names = listing(out);
    expect(names.some((n) => n.endsWith(".wav"))).toBe(false);
    expect(names).not.toContain("masters");
    expect(names).not.toContain("captions");
    expect(names).not.toContain("notes.json");
    expect(names).not.toContain("index.json");
    expect(
      names.every((n) => /^[0-9a-f]{64}\.[a-z0-9]+$|^export-index/.test(n)),
    ).toBe(true);
  });

  it("--drafts adds drafts; without it they stay out", async () => {
    seed();
    const off = join(dir, "off");
    const on = join(dir, "on");
    await cli(["export", jobPath(), "--out", off]);
    await cli(["export", jobPath(), "--out", on, "--drafts"]);
    expect(Object.keys(readExport(off).assets)).not.toContain("glow.n1-house");
    const doc = readExport(on);
    expect(Object.keys(doc.assets).sort()).toEqual([
      "glow.n1-house",
      "n1-house.02~vo-01",
      "painting.n1-house",
      "sound.door",
    ]);
    expect(doc.assets["glow.n1-house"]?.status).toBe("draft");
    expect(doc.assets["sound.door"]?.size).toEqual({ seconds: 1.5 });
  });

  it("a line carries its speaker and text from the job", async () => {
    seed();
    const out = join(dir, "out");
    await cli(["export", jobPath(), "--out", out]);
    const line = readExport(out).assets["n1-house.02~vo-01"];
    expect(line).toMatchObject({
      kind: "line",
      speaker: "count",
      text: "Come in, late.",
      size: { seconds: 1.5 },
    });
    expect(readExport(out).assets["painting.n1-house"]).not.toHaveProperty(
      "speaker",
    );
  });

  it("a multi-profile picture exports one entry per profile as <id>~<profile>", async () => {
    seed();
    draft("foe.shade~ipad", "foe", "webp", "foe-ipad");
    setStatus("foe.shade~ipad", "final");
    const out = join(dir, "out");
    await cli(["export", jobPath(), "--out", out]);
    const doc = readExport(out);
    expect(doc.assets["foe.shade~ipad"]?.status).toBe("final");
    expect(doc.assets["foe.shade"]).toBeUndefined();
    // a one-profile picture keeps its bare id
    expect(doc.assets["painting.n1-house"]).toBeDefined();
  });

  it("an empty final set writes an empty valid index and no media", async () => {
    writeJob();
    const out = join(dir, "out");
    const r = await cli(["export", jobPath(), "--out", out]);
    expect(r.code).toBe(0);
    expect(readExport(out)).toEqual({
      schema: 1,
      story: "dracula",
      source: SOURCE,
      assets: {},
    });
    expect(listing(out)).toEqual(["export-index.json"]);
  });

  it("a failed export leaves the previous export unchanged", async () => {
    seed();
    const out = join(dir, "out");
    expect((await cli(["export", jobPath(), "--out", out])).code).toBe(0);
    const before = listing(out).map((n) => [
      n,
      readFileSync(join(out, n), "utf8"),
    ]);

    // approve a second asset, then corrupt its store file after the first copy
    draft("foe.shade~ipad", "foe", "webp", "foe-ipad");
    setStatus("foe.shade~ipad", "final");
    const file = readIndex(paths())["foe.shade~ipad"]?.file as string;
    writeFileSync(join(paths().store, file), "tampered");

    const r = await cli(["export", jobPath(), "--out", out]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-EXPORT-2");
    const after = listing(out).map((n) => [
      n,
      readFileSync(join(out, n), "utf8"),
    ]);
    expect(after).toEqual(before);
    // no staging leftovers beside it
    expect(readdirSync(dir).filter((n) => n.includes("export-tmp"))).toEqual(
      [],
    );
  });

  it("a final entry whose store file is missing fails", async () => {
    seed();
    const file = readIndex(paths())["painting.n1-house"]?.file as string;
    rmSync(join(paths().store, file));
    const r = await cli(["export", jobPath(), "--out", join(dir, "out")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-EXPORT-2");
    expect(existsSync(join(dir, "out"))).toBe(false);
  });

  it("refuses an out folder inside the work folder or a non-empty stranger", async () => {
    seed();
    const inside = await cli([
      "export",
      jobPath(),
      "--out",
      join(paths().root, "x"),
    ]);
    expect(inside.err).toContain("AS-EXPORT-3");
    const stranger = join(dir, "stranger");
    mkdirSync(stranger);
    writeFileSync(join(stranger, "keep.txt"), "mine");
    const r = await cli(["export", jobPath(), "--out", stranger]);
    expect(r.err).toContain("AS-EXPORT-3");
    expect(readFileSync(join(stranger, "keep.txt"), "utf8")).toBe("mine");
  });

  it("refuses a WAV in the index", async () => {
    seed();
    const put = putFile(paths().store, new TextEncoder().encode("w"), "wav");
    const index = readIndex(paths());
    const entry = index["sound.door"];
    if (entry === undefined) throw new Error("seed");
    writeIndex(paths(), {
      ...index,
      "sound.door": { ...entry, file: put.file, status: "final" },
    });
    const r = await cli(["export", jobPath(), "--out", join(dir, "o2")]);
    expect(r.err).toContain("AS-EXPORT-2");
  });

  it("fails AS-CONFIG-1 with no work folder", async () => {
    let err = "";
    const code = await main(["export", "j.json", "--out", "o"], {
      env: { ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg") },
      cwd: dir,
      stdout: () => {},
      stderr: (t) => {
        err += t;
      },
    });
    expect(code).toBe(3);
    expect(err).toContain("AS-CONFIG-1");
  });

  it.each([
    [["export"]],
    [["export", "j.json"]],
    [["export", "--out", "o"]],
    [["export", "j.json", "--out"]],
    [["export", "j.json", "--out", "o", "x"]],
    [["export", "j.json", "--out", "o", "--drafts=1"]],
    [["export", "j.json", "--out", "o", "--ai"]],
  ])("%j is a usage error", async (args) => {
    const r = await cli(args);
    expect(r.code).toBe(2);
    expect(r.err).toContain("AS-USAGE-1");
  });
});
