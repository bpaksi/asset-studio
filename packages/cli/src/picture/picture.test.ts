import { createHash } from "node:crypto";
import {
  chmodSync,
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
import type { AssetIndex, Job } from "@asset-studio/formats";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../bin/cli.js";
import "./render.js";

type Rgb = [number, number, number];
const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 200, 0];
const BLUE: Rgb = [0, 0, 255];
const YELLOW: Rgb = [255, 255, 0];

let dir: string;
let work: string;
const story = "dracula";
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "as-picture-")));
  work = join(dir, "work");
  mkdirSync(work);
  mkdirSync(join(dir, "art"));
});
afterEach(() => {
  try {
    chmodSync(join(work, story, "store"), 0o755);
  } catch {
    // no store was created by this test
  }
  rmSync(dir, { recursive: true, force: true });
});

const png = (
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgb,
): Promise<Buffer> => {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw.set(paint(x, y), (y * width + x) * 3);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
};

/** 64x32: red x<24, blue 24..39, green x>=40; a yellow block at x 4..11, y 4..11. */
const bands = (x: number, y: number): Rgb =>
  x >= 4 && x < 12 && y >= 4 && y < 12
    ? YELLOW
    : x < 24
      ? RED
      : x < 40
        ? BLUE
        : GREEN;

const put = (name: string, bytes: Buffer) =>
  writeFileSync(join(dir, "art", name), bytes);

const decode = async (path: string) => {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const meta = await sharp(path).metadata();
  return { data, width: info.width, height: info.height, format: meta.format };
};
const at = (
  img: { data: Buffer; width: number },
  x: number,
  y: number,
): Rgb => {
  const i = (y * img.width + x) * 3;
  return [img.data[i] ?? -1, img.data[i + 1] ?? -1, img.data[i + 2] ?? -1];
};

const baseJob = (over: Partial<Job> = {}): Job => ({
  schema: 1,
  story,
  source: `sha256:${"c".repeat(64)}`,
  profiles: {
    wide: { width: 32, height: 16 },
    square: { width: 32, height: 32 },
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

const run = async (job: Job, extra: string[] = ["--only", "picture"]) => {
  writeFileSync(join(dir, "asset-job.json"), JSON.stringify(job));
  let out = "";
  let err = "";
  const code = await main(
    ["--work-folder", work, "render", "asset-job.json", ...extra],
    {
      env: {
        PATH: process.env.PATH,
        ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg"),
      },
      cwd: dir,
      stdout: (t) => {
        out += t;
      },
      stderr: (t) => {
        err += t;
      },
    },
  );
  return { code, out, err };
};

const storeDir = () => join(work, story, "store");
const readIdx = (): AssetIndex =>
  JSON.parse(readFileSync(join(work, story, "index.json"), "utf8"));
const fileHash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
/** name -> hash of every file under a folder (non-recursive). */
const snapshot = (folder: string): Record<string, string> => {
  try {
    return Object.fromEntries(
      readdirSync(folder).map((f) => [f, fileHash(join(folder, f))]),
    );
  } catch {
    return {};
  }
};
const entry = (key: string) => {
  const e = readIdx()[key];
  if (e === undefined || e.file === null) {
    throw new Error(`no index entry ${key}`);
  }
  return { ...e, file: e.file };
};

const foeJob = (profiles: string[]) =>
  baseJob({
    pictures: [
      {
        id: "foe.shade",
        kind: "foe",
        profiles,
        source: "art/shade.png",
      },
    ],
  });

describe("S5-01 decode and profile pixels", () => {
  it("emits one WebP per profile at the exact size with a cover crop, master kept", async () => {
    const source = await png(64, 32, bands);
    put("shade.png", source);
    const result = await run(foeJob(["wide", "square", "tall"]));
    expect(result.code).toBe(0);
    expect(result.out).toContain("rendered 3, failed 0");
    // 2+ profiles: keyed <id>~<profile>, no bare key.
    expect(Object.keys(readIdx()).sort()).toEqual([
      "foe.shade~square",
      "foe.shade~tall",
      "foe.shade~wide",
    ]);

    const wide = await decode(join(storeDir(), entry("foe.shade~wide").file));
    expect([wide.format, wide.width, wide.height]).toEqual(["webp", 32, 16]);
    // 2:1 into 2:1: half scale. Interior points of each band (lossless WebP,
    // so flat regions are exact; edges are not sampled).
    expect(at(wide, 3, 12)).toEqual(RED); // source (6..7, 24)
    expect(at(wide, 16, 12)).toEqual(BLUE); // source (32, 24)
    expect(at(wide, 28, 12)).toEqual(GREEN); // source (56, 24)
    expect(at(wide, 4, 4)).toEqual(YELLOW); // source (8, 8)

    // 2:1 into 1:1: no scaling, centre 32 columns (x 16..47) kept.
    const square = await decode(
      join(storeDir(), entry("foe.shade~square").file),
    );
    expect([square.width, square.height]).toEqual([32, 32].slice(0, 2));
    // height 32 -> scale 1, crop x 16..47; but a 64x32 source is 32 tall so
    // this is a pure crop: target (2,20) = source (18,20) red, (16,20) blue,
    // (30,20) = source (46,20) green; yellow (x 4..11) is cropped away.
    expect(at(square, 2, 20)).toEqual(RED);
    expect(at(square, 16, 20)).toEqual(BLUE);
    expect(at(square, 30, 20)).toEqual(GREEN);
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) {
        expect(at(square, x, y)).not.toEqual(YELLOW);
      }
    }

    // 2:1 into 1:2: crop only, centre 16 columns (x 24..39) = all blue.
    const tall = await decode(join(storeDir(), entry("foe.shade~tall").file));
    expect([tall.width, tall.height]).toEqual([16, 32]);
    for (let x = 0; x < 16; x++) {
      expect(at(tall, x, 0)).toEqual(BLUE);
      expect(at(tall, x, 31)).toEqual(BLUE);
    }

    // Three separate store files; the master is the original, byte for byte.
    const files = new Set(
      ["wide", "square", "tall"].map((p) => entry(`foe.shade~${p}`).file),
    );
    expect(files.size).toBe(3);
    expect(entry("foe.shade~tall").size).toEqual({ width: 16, height: 32 });
    expect(entry("foe.shade~wide").status).toBe("draft");
    expect(
      readFileSync(join(work, story, "masters", "foe.shade.png")).equals(
        source,
      ),
    ).toBe(true);
  });

  it("keeps the bare id for a one-profile picture", async () => {
    put("shade.png", await png(64, 32, bands));
    expect((await run(foeJob(["wide"]))).code).toBe(0);
    expect(Object.keys(readIdx())).toEqual(["foe.shade"]);
  });
});

describe("S5-02 mood stills", () => {
  const castJob = () =>
    baseJob({
      cast: [
        {
          id: "count",
          name: "Count",
          voice: { provider: "gemini-tts", voiceId: "Charon" },
          moods: ["neutral", "angry"],
          portraits: [
            { mood: "neutral", source: "art/count-n.png" },
            { mood: "angry", source: "art/count-a.png" },
          ],
        },
        {
          id: "innkeeper",
          name: "Innkeeper",
          moods: ["sly"],
          portraits: [{ mood: "sly", source: "art/inn-s.png" }],
        },
        {
          id: "mute",
          name: "Mute",
          voice: { provider: "gemini-tts", voiceId: "Puck" },
          moods: [],
        },
      ],
    });

  it("renders every requested mood at the portrait profile, and nothing for moods: []", async () => {
    put("count-n.png", await png(40, 40, () => RED));
    put("count-a.png", await png(40, 40, () => GREEN));
    put("inn-s.png", await png(20, 30, () => BLUE));
    const result = await run(castJob());
    expect(result.code).toBe(0);
    expect(Object.keys(readIdx()).sort()).toEqual([
      "portrait.count",
      "portrait.count~angry",
      "portrait.innkeeper~sly",
    ]);
    for (const [key, color] of [
      ["portrait.count", RED],
      ["portrait.count~angry", GREEN],
      ["portrait.innkeeper~sly", BLUE],
    ] as const) {
      const img = await decode(join(storeDir(), entry(key).file));
      expect([img.format, img.width, img.height]).toEqual(["webp", 16, 20]);
      expect(at(img, 8, 10)).toEqual(color);
      expect(entry(key).kind).toBe("portrait");
    }
    // The voiced speaker with moods: [] has no id anywhere.
    expect(JSON.stringify(readIdx())).not.toContain("mute");
    expect(readdirSync(storeDir())).toHaveLength(3);
    expect(readdirSync(join(work, story, "masters"))).not.toContain(
      "portrait.mute.png",
    );
  });

  it("fails a missing source with its id and code and invents nothing", async () => {
    put("count-n.png", await png(40, 40, () => RED));
    // count-a.png is missing
    put("inn-s.png", await png(20, 30, () => BLUE));
    const result = await run(castJob());
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/AS-PICTURE-1: portrait\.count~angry/);
    expect(result.out).toContain("rendered 2, failed 1");
    expect(readIdx()["portrait.count~angry"]).toBeUndefined();
  });

  it("leaves a mood with no source missing", async () => {
    const job = castJob();
    job.cast[0] = { ...job.cast[0], portraits: [] } as never;
    put("inn-s.png", await png(20, 30, () => BLUE));
    const result = await run(job);
    expect(result.code).toBe(0);
    expect(Object.keys(readIdx())).toEqual(["portrait.innkeeper~sly"]);
  });
});

describe("S5-03 glow mask pixels and alignment", () => {
  // Painting 40x20: blue everywhere, red block x 24..31, y 4..9 (off-centre).
  const inBlock = (x: number, y: number) =>
    x >= 24 && x < 32 && y >= 4 && y < 10;
  const painting = () => png(40, 20, (x, y) => (inBlock(x, y) ? RED : BLUE));
  // Mask: lit (white) exactly over the block; an off-centre dot at (3,15) too.
  const mask = () =>
    png(40, 20, (x, y) => {
      const lit = inBlock(x, y) || (x === 3 && y === 15);
      return lit ? [255, 255, 255] : [0, 0, 0];
    });
  const glowJob = (profiles: string[]) =>
    baseJob({
      profiles: {
        full: { width: 40, height: 20 },
        half: { width: 20, height: 10 },
        crop: { width: 20, height: 20 },
      },
      pictures: [
        {
          id: "painting.n1-house",
          kind: "painting",
          profiles,
          source: "art/house.png",
          glow: true,
        },
      ],
    });
  const setup = async () => {
    put("house.png", await painting());
    mkdirSync(join(work, story, "masters"), { recursive: true });
    writeFileSync(
      join(work, story, "masters", "glow.n1-house.png"),
      await mask(),
    );
  };
  const bbox = (
    img: { data: Buffer; width: number; height: number },
    test: (rgb: Rgb) => boolean,
    skip?: (x: number, y: number) => boolean,
  ) => {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (skip?.(x, y) === true || !test(at(img, x, y))) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    return [x0, y0, x1, y1];
  };

  it("stores a greyscale WebP at the painting size aligned pixel for pixel", async () => {
    await setup();
    const result = await run(glowJob(["full"]));
    expect(result.code).toBe(0);
    expect(result.out).toContain("rendered 2, failed 0");
    const p = await decode(join(storeDir(), entry("painting.n1-house").file));
    const m = await decode(join(storeDir(), entry("glow.n1-house").file));
    expect([m.format, m.width, m.height]).toEqual(["webp", 40, 20]);
    expect(entry("glow.n1-house").kind).toBe("glow");
    let mismatches = 0;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 40; x++) {
        const [r, g, b] = at(m, x, y);
        expect(r === g && g === b).toBe(true); // R=G=B
        const lit = r > 128;
        const red = at(p, x, y)[0] === 255 && at(p, x, y)[2] === 0;
        // Overlay: lit where the painting's block is, except the extra dot.
        if (lit !== red && !(x === 3 && y === 15)) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
    expect(at(m, 3, 15)).toEqual([255, 255, 255]); // the off-centre feature
    expect(at(m, 3, 14)).toEqual([0, 0, 0]);
  });

  it("derived profiles apply the same transform to painting and mask", async () => {
    await setup();
    const result = await run(glowJob(["half", "crop"]));
    expect(result.code).toBe(0);
    expect(Object.keys(readIdx()).sort()).toEqual([
      "glow.n1-house~crop",
      "glow.n1-house~half",
      "painting.n1-house~crop",
      "painting.n1-house~half",
    ]);
    for (const profile of ["half", "crop"] as const) {
      const p = await decode(
        join(storeDir(), entry(`painting.n1-house~${profile}`).file),
      );
      const m = await decode(
        join(storeDir(), entry(`glow.n1-house~${profile}`).file),
      );
      expect([m.width, m.height]).toEqual([p.width, p.height]);
      const dot = (x: number, y: number) =>
        profile === "half" ? x < 6 && y > 6 : false;
      const lit = bbox(m, ([r]) => r > 128, dot);
      const red = bbox(p, ([r, , b]) => r > 128 && b < 128);
      for (let i = 0; i < 4; i++) {
        expect(Math.abs((lit[i] ?? 0) - (red[i] ?? 0))).toBeLessThanOrEqual(1);
      }
      expect(red[2]).toBeGreaterThan(0);
    }
    // Half: the block lands at x 12..15, y 2..4 (source 24..31, 4..9).
    const half = await decode(
      join(storeDir(), entry("glow.n1-house~half").file),
    );
    expect(at(half, 13, 3)[0]).toBeGreaterThan(200);
    expect(at(half, 5, 3)[0]).toBeLessThan(50);
    // Crop: centre 20 columns (x 10..29) kept; the block is cut at x 29 -> 19.
    const crop = await decode(
      join(storeDir(), entry("glow.n1-house~crop").file),
    );
    expect(at(crop, 16, 6)).toEqual([255, 255, 255]);
    expect(at(crop, 5, 6)).toEqual([0, 0, 0]);
    expect(at(crop, 3 - 10 + 10, 15)).toEqual([0, 0, 0]); // dot at x=3 is cropped away
  });
});

describe("S5-04 negative media", () => {
  const glowJob = () =>
    baseJob({
      pictures: [
        {
          id: "painting.n1-house",
          kind: "painting",
          profiles: ["wide"],
          source: "art/house.png",
          glow: true,
        },
      ],
    });
  const masterPath = () => join(work, story, "masters", "glow.n1-house.png");
  const setMask = (bytes: Buffer) => {
    mkdirSync(join(work, story, "masters"), { recursive: true });
    writeFileSync(masterPath(), bytes);
  };
  const goodState = async () => {
    put("house.png", await png(40, 20, () => BLUE));
    setMask(await png(40, 20, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255])));
    expect((await run(glowJob())).code).toBe(0);
    return {
      store: snapshot(storeDir()),
      index: readFileSync(join(work, story, "index.json"), "utf8"),
    };
  };
  const unchanged = (before: Awaited<ReturnType<typeof goodState>>) => {
    expect(snapshot(storeDir())).toEqual(before.store);
    expect(readFileSync(join(work, story, "index.json"), "utf8")).toBe(
      before.index,
    );
  };

  it("wrong-size mask: AS-GLOW-1 with the id and both sizes", async () => {
    const before = await goodState();
    setMask(await png(20, 10, () => [255, 255, 255]));
    const result = await run(glowJob());
    expect(result.code).toBe(1);
    expect(result.err).toContain("AS-GLOW-1");
    expect(result.err).toContain("glow.n1-house");
    expect(result.err).toContain("20x10");
    expect(result.err).toContain("40x20");
    unchanged(before);
  });

  it("coloured mask is rejected", async () => {
    const before = await goodState();
    setMask(await png(40, 20, (x) => (x === 5 ? [255, 0, 0] : [9, 9, 9])));
    const result = await run(glowJob());
    expect(result.code).toBe(1);
    expect(result.err).toContain("AS-GLOW-4");
    expect(result.err).toContain("glow.n1-house");
    unchanged(before);
  });

  it("corrupt mask and missing hand master are coded failures", async () => {
    const before = await goodState();
    setMask(Buffer.from("not an image at all"));
    let result = await run(glowJob());
    expect(result.code).toBe(1);
    expect(result.err).toContain("AS-GLOW-3");
    unchanged(before);
    rmSync(masterPath());
    result = await run(glowJob());
    expect(result.code).toBe(1);
    expect(result.err).toContain("AS-GLOW-2");
    expect(result.err).toContain("glow.n1-house");
    unchanged(before);
  });

  it("corrupt or missing source is a coded failure with nothing committed", async () => {
    put("house.png", Buffer.from("\x89PNG\r\n\x1a\ntruncated"));
    let result = await run(glowJob());
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/AS-PICTURE-1: painting\.n1-house/);
    expect(existsSync(join(work, story))).toBe(false);
    rmSync(join(dir, "art", "house.png"));
    result = await run(glowJob());
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/AS-PICTURE-1: painting\.n1-house/);
  });

  it("a corrupt source does not touch earlier good output", async () => {
    const before = await goodState();
    put("house.png", Buffer.from("garbage"));
    const result = await run(glowJob());
    expect(result.code).toBe(1);
    unchanged(before);
  });
});

describe("S5-05 store integrity and replay", () => {
  const twoJob = () =>
    baseJob({
      pictures: [
        {
          id: "foe.shade",
          kind: "foe",
          profiles: ["wide"],
          source: "art/shade.png",
        },
        {
          id: "foe.bat",
          kind: "foe",
          profiles: ["wide", "tall"],
          source: "art/bat.png",
        },
      ],
    });
  const setup = async () => {
    put("shade.png", await png(64, 32, bands));
    put("bat.png", await png(64, 32, () => GREEN));
  };

  it("an identical render adds nothing and keeps statuses and masters", async () => {
    await setup();
    expect((await run(twoJob())).code).toBe(0);
    const { approve } = await import("../needs/needs.js");
    const { workPaths } = await import("../store/store.js");
    approve(twoJob(), workPaths(work, story), "foe.shade");
    const index = readFileSync(join(work, story, "index.json"), "utf8");
    const store = snapshot(storeDir());
    const masters = snapshot(join(work, story, "masters"));
    const second = await run(twoJob());
    expect(second.code).toBe(0);
    expect(snapshot(storeDir())).toEqual(store);
    expect(readFileSync(join(work, story, "index.json"), "utf8")).toBe(index);
    expect(snapshot(join(work, story, "masters"))).toEqual(masters);
    expect(entry("foe.shade").status).toBe("final");
    expect(Object.keys(store)).toHaveLength(3);
  });

  it("a changed input stores new bytes; old and unrelated files survive", async () => {
    await setup();
    await run(twoJob());
    const before = snapshot(storeDir());
    const idx = readIdx();
    const masters = snapshot(join(work, story, "masters"));
    put("shade.png", await png(64, 32, () => YELLOW));
    expect((await run(twoJob())).code).toBe(0);
    const after = snapshot(storeDir());
    // Every earlier store file is still there, byte for byte.
    for (const [name, hash] of Object.entries(before)) {
      expect(after[name]).toBe(hash);
    }
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length + 1);
    expect(entry("foe.shade").file).not.toBe(idx["foe.shade"]?.file);
    // The other picture, both profiles, is untouched.
    expect(entry("foe.bat~wide")).toEqual(idx["foe.bat~wide"]);
    expect(entry("foe.bat~tall")).toEqual(idx["foe.bat~tall"]);
    // The master was not resaved in place.
    expect(snapshot(join(work, story, "masters"))).toEqual(masters);
  });

  it.skipIf(process.getuid?.() === 0)(
    "a write failure leaves the index byte-identical and nothing final",
    async () => {
      await setup();
      await run(twoJob());
      const index = readFileSync(join(work, story, "index.json"), "utf8");
      const store = snapshot(storeDir());
      put("shade.png", await png(64, 32, () => YELLOW));
      chmodSync(storeDir(), 0o555);
      const result = await run(twoJob());
      chmodSync(storeDir(), 0o755);
      expect(result.code).toBe(1);
      expect(result.err).toMatch(/AS-PICTURE-9: foe\.shade/);
      expect(readFileSync(join(work, story, "index.json"), "utf8")).toBe(index);
      expect(snapshot(storeDir())).toEqual(store);
      expect(Object.values(readIdx()).every((e) => e.status === "draft")).toBe(
        true,
      );
    },
  );
});
