import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "@asset-studio/formats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../bin/cli.js";
import { approve, reject } from "../needs/needs.js";
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
      moods: ["neutral", "angry"],
    },
  ],
  lines: [
    { id: "n1-house.02~vo-01", speaker: "count", text: "Come in, late." },
    { id: "n1-house.03~vo-02", speaker: "count", text: "CAPTION-ONLY-TEXT" },
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

const setStatus = (key: string, status: "final" | "rejected") => {
  if (status === "final") approve(makeJob(), paths(), key);
  else reject(makeJob(), paths(), key, "not good");
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
  draft("portrait.count", "portrait", "webp", "still-neutral");
  draft("portrait.count~angry", "portrait", "webp", "still-angry");
  approve(job, paths(), "portrait.count~angry");
  reject(job, paths(), "glow.n1-house", "mask too wide");
  setStatus("foe.shade~board", "rejected");
  // masters and a caption record sit beside the store and must never ship
  mkdirSync(join(paths().root, "masters"), { recursive: true });
  writeFileSync(join(paths().root, "masters", "n1-house.02~vo-01.wav"), "RIFF");
  mkdirSync(join(paths().root, "captions"), { recursive: true });
  // a caption-only failure: the line stays missing, its record is in captions/
  writeFileSync(
    join(paths().root, "captions", "n1-house.03~vo-02.json"),
    '{"text":"CAPTION-ONLY-TEXT"}',
  );
  // settings and a secret-like file in the work folder
  writeFileSync(join(work, "settings.json"), '{"key":"SECRET-KEY-123"}');
  writeFileSync(join(paths().root, ".env"), "GEMINI_API_KEY=SECRET-KEY-123");
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
      "portrait.count~angry",
    ]);
    expect(doc.assets["portrait.count~angry"]).toMatchObject({
      kind: "portrait",
      status: "final",
      size: { width: 8, height: 4 },
    });
    expect(doc.source).toBe(SOURCE);
    const idx = readIndex(paths());
    const files = [
      idx["n1-house.02~vo-01"]?.file,
      idx["painting.n1-house"]?.file,
      idx["portrait.count~angry"]?.file,
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
    expect(Object.keys(readExport(off).assets)).not.toContain("portrait.count");
    const doc = readExport(on);
    expect(Object.keys(doc.assets).sort()).toEqual([
      "n1-house.02~vo-01",
      "painting.n1-house",
      "portrait.count",
      "portrait.count~angry",
      "sound.door",
    ]);
    expect(doc.assets["portrait.count"]?.status).toBe("draft");
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

  it("a glow mask of a multi-profile picture exports one entry per profile", async () => {
    const job = makeJob();
    const shade = job.pictures[1];
    if (shade === undefined) throw new Error("no picture");
    shade.glow = true;
    writeJob(job);
    draft("glow.shade~board", "glow", "webp", "glow-b");
    draft("glow.shade~ipad", "glow", "webp", "glow-i");
    approve(job, paths(), "glow.shade~board");
    approve(job, paths(), "glow.shade~ipad");
    const out = join(dir, "out");
    expect((await cli(["export", jobPath(), "--out", out])).code).toBe(0);
    const doc = readExport(out);
    expect(Object.keys(doc.assets).sort()).toEqual([
      "glow.shade~board",
      "glow.shade~ipad",
    ]);
  });

  it("a ~variant picture with 2+ profiles fails with AS-ID-3 and keeps the previous export", async () => {
    seed();
    const out = join(dir, "out");
    expect((await cli(["export", jobPath(), "--out", out])).code).toBe(0);
    const before = listing(out).map((n) => [
      n,
      readFileSync(join(out, n), "utf8"),
    ]);
    const job = makeJob();
    job.pictures.push({
      id: "foe.shade~night",
      kind: "foe",
      profiles: ["board", "ipad"],
      prompt: "x",
    });
    writeJob(job);
    const r = await cli(["export", jobPath(), "--out", out]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-ID-3");
    const after = listing(out).map((n) => [
      n,
      readFileSync(join(out, n), "utf8"),
    ]);
    expect(after).toEqual(before);
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

  const pointAtWav = (id: string, kind: string) => {
    const put = putFile(paths().store, new TextEncoder().encode("w"), "wav");
    const index = readIndex(paths());
    const entry = index[id];
    if (entry === undefined) throw new Error("seed");
    writeIndex(paths(), {
      ...index,
      [id]: { ...entry, kind, file: put.file, status: "final" },
    });
    return put.file;
  };

  it("refuses a WAV on a voice line", async () => {
    seed();
    pointAtWav("n1-house.02~vo-01", "line");
    const r = await cli(["export", jobPath(), "--out", join(dir, "o2")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-EXPORT-2");
  });

  it("exports a job sound in its own WAV format", async () => {
    seed();
    const file = pointAtWav("sound.door", "effect");
    const out = join(dir, "o3");
    const r = await cli(["export", jobPath(), "--out", out]);
    expect(r.code).toBe(0);
    expect(readExport(out).assets["sound.door"]?.file).toBe(file);
    expect(existsSync(join(out, file))).toBe(true);
  });

  it("a symlinked alias of the story folder cannot be an out folder", async () => {
    seed();
    const alias = join(dir, "alias");
    symlinkSync(paths().root, alias);
    const r = await cli(["export", jobPath(), "--out", join(alias, "x")]);
    expect(r.err).toContain("AS-EXPORT-3");
    expect(existsSync(join(paths().root, "x"))).toBe(false);
  });

  it("a job inside an earlier export, reached by an alias, is not deleted", async () => {
    seed();
    const out = join(dir, "out");
    expect((await cli(["export", jobPath(), "--out", out])).code).toBe(0);
    const inside = join(out, "asset-job.json");
    writeFileSync(inside, JSON.stringify(makeJob()));
    const alias = join(dir, "outalias");
    symlinkSync(out, alias);
    const r = await cli(["export", inside, "--out", alias]);
    expect(r.err).toContain("AS-EXPORT-3");
    expect(existsSync(inside)).toBe(true);
    // the same through the real path
    const r2 = await cli(["export", inside, "--out", out]);
    expect(r2.err).toContain("AS-EXPORT-3");
    expect(existsSync(inside)).toBe(true);
  });

  it("a folder whose export-index.json is not schema 1 is not an earlier export", async () => {
    seed();
    const odd = join(dir, "odd");
    mkdirSync(odd);
    writeFileSync(join(odd, "export-index.json"), "not json");
    writeFileSync(join(odd, "keep.txt"), "mine");
    const r = await cli(["export", jobPath(), "--out", odd]);
    expect(r.err).toContain("AS-EXPORT-3");
    expect(readFileSync(join(odd, "keep.txt"), "utf8")).toBe("mine");
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
