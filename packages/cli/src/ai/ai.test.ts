import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssetIndex, Job } from "@asset-studio/formats";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../bin/cli.js";
import { pictureRenderer } from "../picture/render.js";
import { clearRenderers, registerRenderer } from "../render/registry.js";
import { storeTestHooks } from "../store/store.js";
import { createFakeImageProvider, type FakeImageOptions } from "./fake.js";
import {
  buildPrompt,
  createGeminiImageProvider,
  geminiImageFromEnv,
} from "./gemini.js";
import type { ImageProvider } from "./provider.js";
import { createAiRenderer } from "./render.js";

const story = "dracula";
const KEY = "fake-key-DO-NOT-LOG-7f3a9c";

let dir: string;
let work: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "as-ai-")));
  work = join(dir, "work");
  mkdirSync(work);
  mkdirSync(join(dir, "art"));
  mkdirSync(join(dir, "ref"));
});
afterEach(() => {
  storeTestHooks.beforeCommit = undefined;
  clearRenderers();
  rmSync(dir, { recursive: true, force: true });
});

const baseJob = (over: Partial<Job> = {}): Job => ({
  schema: 1,
  story,
  source: `sha256:${"c".repeat(64)}`,
  profiles: {
    wide: { width: 32, height: 16 },
    tall: { width: 16, height: 32 },
    portrait: { width: 16, height: 20 },
  },
  cast: [],
  lines: [],
  pictures: [],
  moments: [],
  sounds: [],
  ...over,
});

const paintingJob = (ids: string[], extra: Partial<Job> = {}): Job =>
  baseJob({
    pictures: ids.map((id) => ({
      id,
      kind: "painting",
      profiles: ["wide"],
      prompt: `prompt of ${id}`,
    })),
    ...extra,
  });

function useProvider(provider: ImageProvider): void {
  clearRenderers();
  registerRenderer(pictureRenderer);
  registerRenderer(createAiRenderer({ provider: () => provider }));
}

const fakeWith = (options: FakeImageOptions = {}) => {
  const fake = createFakeImageProvider(options);
  useProvider(fake);
  return fake;
};

const run = async (
  job: Job | undefined,
  args: string[] = ["render", "asset-job.json", "--ai"],
  env: Record<string, string | undefined> = {},
  cwd = dir,
) => {
  if (job !== undefined) {
    writeFileSync(join(dir, "asset-job.json"), JSON.stringify(job));
  }
  let out = "";
  let err = "";
  const code = await main(["--work-folder", work, ...args], {
    env: {
      PATH: process.env.PATH,
      ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg"),
      ...env,
    },
    cwd,
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
  });
  return { code, out, err };
};

const storeDir = () => join(work, story, "store");
const readIdx = (): AssetIndex =>
  JSON.parse(readFileSync(join(work, story, "index.json"), "utf8"));
const readNotesFile = (): Record<string, string[]> =>
  JSON.parse(readFileSync(join(work, story, "notes.json"), "utf8"));
const putNotes = (notes: Record<string, string[]>) => {
  mkdirSync(join(work, story), { recursive: true });
  writeFileSync(join(work, story, "notes.json"), JSON.stringify(notes));
};

const solid = (w: number, h: number, rgb: [number, number, number]) =>
  sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: rgb[0], g: rgb[1], b: rgb[2] },
    },
  })
    .png()
    .toBuffer();

const decode = async (path: string) => {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const meta = await sharp(path).metadata();
  return { data, width: info.width, height: info.height, format: meta.format };
};
const isGrey = (data: Buffer) => {
  for (let i = 0; i + 2 < data.length; i += 3) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) return false;
  }
  return true;
};
const storeSnapshot = (): Record<string, string> =>
  Object.fromEntries(
    readdirSync(storeDir()).map((n) => [
      n,
      createHash("sha256")
        .update(readFileSync(join(storeDir(), n)))
        .digest("hex"),
    ]),
  );
const allFiles = (root: string): string[] =>
  readdirSync(root).flatMap((n) => {
    const p = join(root, n);
    return statSync(p).isDirectory() ? allFiles(p) : [p];
  });

describe("P2-06a: AI mode fills what is missing as drafts", () => {
  it("gives the provider the style, references and prompt, and stores drafts at the profile size", async () => {
    writeFileSync(join(dir, "ref", "castle.png"), await solid(4, 4, [9, 9, 9]));
    writeFileSync(join(dir, "ref", "count.png"), await solid(4, 4, [8, 8, 8]));
    const fake = fakeWith();
    const job = baseJob({
      style: { picture: "oil, candlelit", references: ["ref/castle.png"] },
      cast: [
        {
          id: "count",
          name: "The Count",
          moods: ["neutral", "angry"],
          portraits: [{ mood: "angry", prompt: "furious" }],
          references: ["ref/count.png"],
        },
      ],
      pictures: [
        {
          id: "painting.n1-house",
          kind: "painting",
          profiles: ["wide"],
          prompt: "the stair at dawn",
        },
      ],
    });
    const result = await run(job);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("rendered 3, failed 0");

    const byId = Object.fromEntries(fake.calls.map((c) => [c.id, c]));
    const pic = byId["painting.n1-house"];
    expect(pic?.kind).toBe("picture");
    expect(pic?.prompt).toBe("the stair at dawn");
    expect(pic?.style).toBe("oil, candlelit");
    expect(pic?.references.map((r) => r.name)).toEqual(["ref/castle.png"]);
    const angry = byId["portrait.count~angry"];
    expect(angry?.kind).toBe("still");
    expect(angry?.prompt).toBe("furious");
    expect(angry?.subject).toEqual({ name: "The Count", mood: "angry" });
    expect(angry?.references.map((r) => r.name)).toEqual([
      "ref/castle.png",
      "ref/count.png",
    ]);
    const neutral = byId["portrait.count"];
    expect(neutral?.prompt).toBeUndefined(); // made from references + style
    expect(neutral?.style).toBe("oil, candlelit");

    const idx = readIdx();
    expect(Object.keys(idx).sort()).toEqual([
      "painting.n1-house",
      "portrait.count",
      "portrait.count~angry",
    ]);
    for (const entry of Object.values(idx)) expect(entry.status).toBe("draft");
    expect(idx["painting.n1-house"]?.size).toEqual({ width: 32, height: 16 });
    expect(idx["portrait.count"]?.size).toEqual({ width: 16, height: 20 });
    expect(idx["portrait.count"]?.kind).toBe("portrait");
    expect(idx["painting.n1-house"]?.kind).toBe("painting");
    const img = await decode(
      join(storeDir(), idx["painting.n1-house"]?.file ?? ""),
    );
    expect([img.format, img.width, img.height]).toEqual(["webp", 32, 16]);
  });

  it("makes no talking mouths and nothing for source pictures or moodless cast", async () => {
    await sharp(await solid(8, 8, [1, 2, 3])).toFile(join(dir, "art", "s.png"));
    const fake = fakeWith();
    const job = baseJob({
      cast: [{ id: "mute", name: "Mute", moods: [] }],
      pictures: [
        { id: "foe.s", kind: "foe", profiles: ["wide"], source: "art/s.png" },
      ],
    });
    const result = await run(job);
    expect(result.code).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(Object.keys(readIdx())).toEqual(["foe.s"]);
    expect(readIdx()["foe.s"]?.status).toBe("draft");
  });

  it("is off without --ai, and a second --ai run asks for nothing", async () => {
    const fake = fakeWith();
    const job = paintingJob(["painting.a"]);
    const plain = await run(job, ["render", "asset-job.json"]);
    expect(fake.calls).toEqual([]);
    expect(plain.code).toBe(0);
    await run(job);
    expect(fake.calls).toHaveLength(1);
    const again = await run(job);
    expect(again.code).toBe(0);
    expect(fake.calls).toHaveLength(1);
  });

  it("keys a 2-profile picture <id>~<profile> from one request", async () => {
    const fake = fakeWith();
    const job = baseJob({
      pictures: [
        {
          id: "foe.shade",
          kind: "foe",
          profiles: ["wide", "tall"],
          prompt: "a shade",
        },
      ],
    });
    const result = await run(job);
    expect(result.code).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.size).toEqual({ width: 32, height: 16 });
    const idx = readIdx();
    expect(Object.keys(idx).sort()).toEqual([
      "foe.shade~tall",
      "foe.shade~wide",
    ]);
    expect(idx["foe.shade~tall"]?.size).toEqual({ width: 16, height: 32 });
  });

  it("a retry turns a failed (missing) asset into a draft, never final", async () => {
    const job = paintingJob(["painting.a"]);
    fakeWith({ failIds: ["painting.a"] });
    const first = await run(job);
    expect(first.code).toBe(1);
    expect(existsSync(join(work, story, "index.json"))).toBe(false);
    fakeWith();
    const second = await run(job);
    expect(second.code).toBe(0);
    expect(readIdx()["painting.a"]?.status).toBe("draft");
  });

  it("makes a glow mask greyscale at the painting's size and keeps it as the mask master", async () => {
    const fake = fakeWith();
    const job = baseJob({
      pictures: [
        {
          id: "painting.n1-house",
          kind: "painting",
          profiles: ["wide", "tall"],
          prompt: "house",
          glow: true,
        },
      ],
    });
    const result = await run(job);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    const mask = fake.calls.find((c) => c.id === "glow.n1-house");
    expect(mask?.kind).toBe("mask");
    expect(mask?.painting).toBeDefined();
    // The painting is the AI master, 32x16 (largest profile); the mask asks for that size.
    expect(mask?.size).toEqual({ width: 32, height: 16 });
    const master = await decode(
      join(work, story, "masters", "glow.n1-house.png"),
    );
    expect([master.width, master.height]).toEqual([32, 16]);
    expect(isGrey(master.data)).toBe(true);
    const idx = readIdx();
    expect(Object.keys(idx).sort()).toEqual([
      "glow.n1-house~tall",
      "glow.n1-house~wide",
      "painting.n1-house~tall",
      "painting.n1-house~wide",
    ]);
    for (const [key, w, h] of [
      ["glow.n1-house~wide", 32, 16],
      ["glow.n1-house~tall", 16, 32],
    ] as const) {
      const entry = idx[key];
      expect(entry?.kind).toBe("glow");
      expect(entry?.status).toBe("draft");
      const img = await decode(join(storeDir(), entry?.file ?? ""));
      expect([img.format, img.width, img.height]).toEqual(["webp", w, h]);
      expect(isGrey(img.data)).toBe(true);
    }
  });

  it("lights a source painting whose hand mask is absent, at the painting's own size", async () => {
    await sharp(await solid(64, 32, [200, 10, 10])).toFile(
      join(dir, "art", "p.png"),
    );
    const fake = fakeWith();
    const job = baseJob({
      pictures: [
        {
          id: "painting.p",
          kind: "painting",
          profiles: ["wide"],
          source: "art/p.png",
          glow: true,
        },
      ],
    });
    const result = await run(job);
    // S5 reports the missing hand mask; AI mode still fills it.
    expect(result.err).toContain("AS-GLOW-2");
    expect(result.code).toBe(1);
    expect(fake.calls.map((c) => c.id)).toEqual(["glow.p"]);
    expect(fake.calls[0]?.size).toEqual({ width: 64, height: 32 });
    expect(readIdx()["glow.p"]?.status).toBe("draft");
  });
});

describe("P2-06b: redo notes", () => {
  it("sends a note only with its own ID, and clears it after the draft commits", async () => {
    const fake = fakeWith();
    const job = paintingJob(["painting.a", "painting.b", "painting.other"]);
    // Other already final: its note must not be sent or cleared.
    const first = await run(paintingJob(["painting.other"]));
    expect(first.code).toBe(0);
    await run(undefined, ["approve", "asset-job.json", "painting.other"]);
    putNotes({
      "painting.a": ["darker sky"],
      "painting.other": ["keep for other"],
    });
    fake.calls.length = 0;
    const result = await run(job);
    expect(result.code).toBe(0);
    const byId = Object.fromEntries(fake.calls.map((c) => [c.id, c]));
    expect(byId["painting.a"]?.notes).toEqual(["darker sky"]);
    expect(byId["painting.b"]?.notes).toEqual([]);
    expect(byId["painting.other"]).toBeUndefined();
    expect(readNotesFile()).toEqual({ "painting.other": ["keep for other"] });
  });

  it("keeps the note when the request fails, and sends it again on the retry", async () => {
    putNotes({ "painting.a": ["warmer light"] });
    const job = paintingJob(["painting.a"]);
    fakeWith({ failIds: ["painting.a"] });
    const failed = await run(job);
    expect(failed.code).toBe(1);
    expect(readNotesFile()).toEqual({ "painting.a": ["warmer light"] });
    const fake = fakeWith();
    const ok = await run(job);
    expect(ok.code).toBe(0);
    expect(fake.calls[0]?.notes).toEqual(["warmer light"]);
    expect(existsNotes()).toBe(false);
  });

  it("keeps the note when the new draft or index cannot be committed", async () => {
    putNotes({ "painting.a": ["more fog"] });
    const job = paintingJob(["painting.a"]);
    fakeWith();
    storeTestHooks.beforeCommit = (path) => {
      if (path.endsWith("index.json")) throw new Error("disk full");
    };
    const result = await run(job);
    storeTestHooks.beforeCommit = undefined;
    expect(result.code).toBe(1);
    expect(result.err).toContain("painting.a");
    expect(readNotesFile()).toEqual({ "painting.a": ["more fog"] });
    expect(() => readIdx()).toThrow();
  });

  it("redo: a rejected asset with a note is remade as a draft with that note; old file stays; note cleared", async () => {
    const job = paintingJob(["painting.a", "painting.b"]);
    fakeWith();
    await run(job);
    const before = storeSnapshot();
    const oldEntry = readIdx()["painting.a"];
    await run(undefined, [
      "reject",
      "asset-job.json",
      "painting.a",
      "--note",
      "too bright",
    ]);
    await run(undefined, [
      "reject",
      "asset-job.json",
      "painting.b",
      "--note",
      "too dark",
    ]);
    putNotes({ "painting.a": ["too bright"] }); // b's note was consumed elsewhere
    const fake = fakeWith();
    const result = await run(job);
    expect(result.code).toBe(0);
    expect(fake.calls.map((c) => c.id)).toEqual(["painting.a"]);
    expect(fake.calls[0]?.notes).toEqual(["too bright"]);
    const entry = readIdx()["painting.a"];
    expect(entry?.status).toBe("draft");
    expect(entry?.file).not.toBe(oldEntry?.file);
    expect(readIdx()["painting.b"]?.status).toBe("rejected");
    const after = storeSnapshot();
    for (const [name, hash] of Object.entries(before)) {
      expect(after[name]).toBe(hash);
    }
    expect(existsNotes()).toBe(false);
  });

  it("redo: a failed request keeps the asset rejected and keeps the note", async () => {
    const job = paintingJob(["painting.a"]);
    fakeWith();
    await run(job);
    await run(undefined, [
      "reject",
      "asset-job.json",
      "painting.a",
      "--note",
      "more fog",
    ]);
    const before = readIdx()["painting.a"];
    fakeWith({ failIds: ["painting.a"] });
    const result = await run(job);
    expect(result.code).toBe(1);
    expect(result.err).toContain("AS-AI-4: painting.a");
    expect(readIdx()["painting.a"]).toEqual(before);
    expect(readIdx()["painting.a"]?.status).toBe("rejected");
    expect(readNotesFile()).toEqual({ "painting.a": ["more fog"] });
    const fake = fakeWith();
    expect((await run(job)).code).toBe(0);
    expect(fake.calls[0]?.notes).toEqual(["more fog"]);
    expect(readIdx()["painting.a"]?.status).toBe("draft");
  });

  it("a redo note on a missing asset changes the inputs hash and the stored file; the earlier file stays", async () => {
    const job = paintingJob(["painting.a", "painting.b"]);
    fakeWith({ failIds: ["painting.b"] });
    await run(job);
    const before = storeSnapshot();
    const entryA = readIdx()["painting.a"];
    putNotes({ "painting.b": ["add a moon"] });
    const fake = fakeWith();
    const result = await run(job);
    expect(result.code).toBe(0);
    expect(fake.calls.map((c) => c.id)).toEqual(["painting.b"]);
    expect(readIdx()["painting.a"]).toEqual(entryA);
    const after = storeSnapshot();
    for (const [name, hash] of Object.entries(before)) {
      expect(after[name]).toBe(hash);
    }
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length + 1);
  });
});

const existsNotes = (): boolean => {
  try {
    return Object.keys(readNotesFile()).length > 0;
  } catch {
    return false;
  }
};

describe("P2-06c: failures and protected statuses", () => {
  it("logs a middle failure with ID and code, renders the next, exits non-zero with the count", async () => {
    const fake = fakeWith({ failIds: ["painting.b"] });
    const job = paintingJob(["painting.a", "painting.b", "painting.c"]);
    const result = await run(job);
    expect(result.code).toBe(1);
    expect(fake.calls.map((c) => c.id)).toEqual([
      "painting.a",
      "painting.b",
      "painting.c",
    ]);
    expect(result.err).toMatch(/AS-AI-4: painting\.b:/);
    expect(result.out).toContain("rendered 2, failed 1");
    expect(result.err).toContain("AS-RENDER-2");
    const idx = readIdx();
    expect(Object.keys(idx).sort()).toEqual(["painting.a", "painting.c"]);
  });

  it("never regenerates a final asset (even with a note) or a rejected one with no note", async () => {
    const job = paintingJob(["painting.a", "painting.b", "painting.c"]);
    fakeWith();
    await run(job);
    await run(undefined, ["approve", "asset-job.json", "painting.a"]);
    await run(undefined, [
      "reject",
      "asset-job.json",
      "painting.b",
      "--note",
      "no",
    ]);
    // a: final with a stray note; b: rejected, its note gone
    putNotes({ "painting.a": ["ignored"] });
    const before = readFileSync(join(work, story, "index.json"), "utf8");
    const snap = storeSnapshot();
    const fake = fakeWith();
    const result = await run(job);
    expect(result.code).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(readFileSync(join(work, story, "index.json"), "utf8")).toBe(before);
    expect(storeSnapshot()).toEqual(snap);
    expect(readIdx()["painting.a"]?.status).toBe("final");
    expect(readIdx()["painting.b"]?.status).toBe("rejected");
  });

  it("fails media validation before any draft is stored: wrong size, colour, garbage", async () => {
    fakeWith({
      wrong: {
        "glow.size": "size",
        "glow.colour": "colour",
        "painting.junk": "garbage",
      },
    });
    const job = baseJob({
      pictures: [
        {
          id: "painting.size",
          kind: "painting",
          profiles: ["wide"],
          prompt: "x",
          glow: true,
        },
        {
          id: "painting.colour",
          kind: "painting",
          profiles: ["wide"],
          prompt: "x",
          glow: true,
        },
        {
          id: "painting.junk",
          kind: "painting",
          profiles: ["wide"],
          prompt: "x",
        },
      ],
    });
    const result = await run(job);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/AS-AI-6: glow\.size:.*33x16.*32x16/);
    expect(result.err).toMatch(/AS-AI-7: glow\.colour:/);
    expect(result.err).toMatch(/AS-AI-5: painting\.junk:/);
    const idx = readIdx();
    expect(idx["glow.size"]).toBeUndefined();
    expect(idx["glow.colour"]).toBeUndefined();
    expect(idx["painting.junk"]).toBeUndefined();
    expect(idx["painting.size"]?.status).toBe("draft");
    expect(allFiles(storeDir()).every((f) => f.endsWith(".webp"))).toBe(true);
  });

  it("skips a mask whose painting failed and counts it", async () => {
    fakeWith({ failIds: ["painting.a"] });
    const job = baseJob({
      pictures: [
        {
          id: "painting.a",
          kind: "painting",
          profiles: ["wide"],
          prompt: "x",
          glow: true,
        },
      ],
    });
    const result = await run(job);
    expect(result.code).toBe(1);
    expect(result.err).toContain("AS-AI-4: painting.a");
    expect(result.err).toContain("AS-AI-8: glow.a");
    expect(result.out).toContain("failed 2");
  });

  it("reads job-relative references from the job's folder, and a missing one fails only its asset", async () => {
    writeFileSync(join(dir, "ref", "ok.png"), await solid(2, 2, [1, 1, 1]));
    const fake = fakeWith();
    const job = baseJob({
      pictures: [
        { id: "painting.a", kind: "painting", profiles: ["wide"], prompt: "a" },
        { id: "painting.b", kind: "painting", profiles: ["wide"], prompt: "b" },
      ],
      style: { picture: "s", references: ["ref/ok.png"] },
    });
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    const jobPath = join(dir, "asset-job.json");
    writeFileSync(jobPath, JSON.stringify(job));
    const good = await run(
      undefined,
      ["render", jobPath, "--ai"],
      {},
      elsewhere,
    );
    expect(good.code).toBe(0);
    expect(fake.calls[0]?.references[0]?.bytes.length).toBeGreaterThan(0);

    const bad = baseJob({
      pictures: [
        { id: "painting.x", kind: "painting", profiles: ["wide"], prompt: "x" },
      ],
      style: { picture: "s", references: ["ref/nope.png"] },
    });
    const result = await run(bad);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/AS-AI-3: painting\.x: cannot read reference/);
  });

  it("does not let a request change the job or touch another story", async () => {
    const inner = createFakeImageProvider();
    useProvider({
      id: "mutator",
      generate: async (req) => {
        req.notes.push("injected");
        req.references.push({ name: "x", bytes: new Uint8Array(1) });
        req.size.width = 1;
        return inner.generate({ ...req, size: { width: 32, height: 16 } });
      },
    });
    const job = paintingJob(["painting.a", "painting.b"]);
    writeFileSync(join(dir, "asset-job.json"), JSON.stringify(job));
    const jobBytes = readFileSync(join(dir, "asset-job.json"));
    mkdirSync(join(work, "other-story"));
    const result = await run(undefined);
    expect(result.code).toBe(0);
    expect(readFileSync(join(dir, "asset-job.json")).equals(jobBytes)).toBe(
      true,
    );
    expect(readdirSync(work).sort()).toEqual([story, "other-story"]);
    expect(readdirSync(join(work, "other-story"))).toEqual([]);
  });

  it("without a key (default provider) fails AS-AI-1 only when there is work", async () => {
    clearRenderers();
    registerRenderer(pictureRenderer);
    registerRenderer(createAiRenderer());
    const none = await run(baseJob());
    expect(none.code).toBe(0);
    const result = await run(paintingJob(["painting.a"]), undefined, {
      GEMINI_API_KEY: undefined,
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain("AS-AI-1");
  });
});

describe("Gemini image provider (mocked fetch) and the key", () => {
  const png1 = async () => solid(32, 16, [5, 6, 7]);
  const okReply = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "here" },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: (await png1()).toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );

  it("sends prompt, style, notes, references and the key header; parses the image", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = createGeminiImageProvider({
      apiKey: KEY,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return okReply();
      }) as unknown as typeof fetch,
    });
    const out = await provider.generate({
      kind: "picture",
      id: "painting.a",
      prompt: "a stair",
      style: "oil",
      references: [{ name: "ref/x.png", bytes: await png1() }],
      notes: ["more fog"],
      size: { width: 32, height: 16 },
    });
    expect(out.image.length).toBeGreaterThan(0);
    const call = calls[0];
    expect(call?.url).toContain(
      "/models/gemini-2.5-flash-image:generateContent",
    );
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe(KEY);
    const body = String(call?.init.body);
    expect(body).not.toContain(KEY);
    expect(body).toContain("a stair");
    expect(body).toContain("Style: oil");
    expect(body).toContain("more fog");
    expect(body).toContain("inlineData");
    expect(
      buildPrompt({
        kind: "mask",
        id: "glow.a",
        references: [],
        notes: [],
        size: { width: 3, height: 2 },
      }),
    ).toContain("Greyscale only");
  });

  it("reports HTTP errors, empty replies and a missing key", async () => {
    const req = {
      kind: "picture" as const,
      id: "painting.a",
      references: [],
      notes: [],
      size: { width: 4, height: 4 },
    };
    const http = createGeminiImageProvider({
      apiKey: KEY,
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "quota" } }), {
          status: 429,
        })) as unknown as typeof fetch,
    });
    await expect(http.generate(req)).rejects.toThrow(/quota/);
    const empty = createGeminiImageProvider({
      apiKey: KEY,
      fetch: (async () =>
        new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    await expect(empty.generate(req)).rejects.toThrow(/no image/);
    expect(() => geminiImageFromEnv({})).toThrow(/GEMINI_API_KEY/);
  });

  it("never lets the key reach output, index, notes or the store, even when an error echoes it", async () => {
    const png = await png1();
    const seen: string[] = [];
    const provider = createGeminiImageProvider({
      apiKey: KEY,
      fetch: (async (_url: string, init: RequestInit) => {
        const body = String(init.body);
        seen.push(body);
        if (body.includes("prompt of painting.b")) {
          return new Response(
            JSON.stringify({ error: { message: `bad key ${KEY}` } }),
            { status: 403 },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: png.toString("base64"),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    useProvider(provider);
    putNotes({ "painting.b": ["try again"] });
    const result = await run(
      paintingJob(["painting.a", "painting.b"]),
      undefined,
      { GEMINI_API_KEY: KEY },
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain("AS-AI-4: painting.b");
    expect(result.err).toContain("[redacted]");
    expect(result.out + result.err).not.toContain(KEY);
    for (const file of allFiles(join(work, story))) {
      expect(readFileSync(file).includes(KEY), file).toBe(false);
    }
    expect(seen.some((b) => b.includes(KEY))).toBe(false);
    expect(readNotesFile()).toEqual({ "painting.b": ["try again"] });
  });
});
