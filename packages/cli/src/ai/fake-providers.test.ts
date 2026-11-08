import {
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  execFile: spawned,
  spawn: spawned,
  spawnSync: spawned,
}));

import { main } from "../bin/cli.js";
import "../picture/render.js";
import "../voice/render.js";
import "./render.js";
import { pictureRenderer } from "../picture/render.js";
import { clearRenderers, registerRenderer } from "../render/registry.js";
import { createFakeTtsProvider } from "../tts/fake.js";
import { providerRegistry } from "../tts/provider.js";
import { parseWav } from "../tts/wav.js";
import { createVoiceRenderer } from "../voice/render.js";
import { fakeProvider, TINY_M4A } from "../voice/test-helpers.js";
import { createFakeImageProvider } from "./fake.js";
import { createAiRenderer } from "./render.js";

const NOTICE =
  "AS-FAKE-1: fake providers in use (ASSET_STUDIO_FAKE_PROVIDERS=1); output is not real media";

let dir: string;
let work: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "as-fake-")));
  work = join(dir, "work");
  mkdirSync(work);
  spawned.mockClear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const job: Job = {
  schema: 1,
  story: "fakes",
  source: `sha256:${"d".repeat(64)}`,
  profiles: { wide: { width: 32, height: 16 } },
  cast: [
    {
      id: "keeper",
      name: "Keeper",
      voice: { provider: "gemini-tts", voiceId: "Kore" },
      moods: [],
    },
  ],
  lines: [
    { id: "line.one", speaker: "keeper", text: "Welcome. [pause 0.5] Go." },
  ],
  pictures: [
    {
      id: "painting.hall",
      kind: "painting",
      profiles: ["wide"],
      prompt: "a hall",
    },
  ],
  moments: [],
  sounds: [],
} as Job;

const run = async (args: string[], env: Record<string, string | undefined>) => {
  writeFileSync(join(dir, "asset-job.json"), JSON.stringify(job));
  let out = "";
  let err = "";
  const code = await main(["--work-folder", work, ...args], {
    env: {
      PATH: process.env.PATH,
      ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg"),
      ...env,
    },
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

const stored = () => readdirSync(join(work, "fakes", "store")).sort();

describe("ASSET_STUDIO_FAKE_PROVIDERS", () => {
  it("renders a voiced line with no key, prints AS-FAKE-1, never spawns afconvert", async () => {
    const r = await run(["render", "asset-job.json"], {
      ASSET_STUDIO_FAKE_PROVIDERS: "1",
    });
    expect(r.err).toContain(NOTICE);
    expect(r.err).not.toContain("AS-VOICE");
    expect(r.out).toContain("failed 0");
    expect(r.code).toBe(0);
    expect(stored().some((f) => f.endsWith(".m4a"))).toBe(true);
    const index = JSON.parse(
      readFileSync(join(work, "fakes", "index.json"), "utf8"),
    );
    expect(JSON.stringify(index)).not.toContain('"final"');
    expect(spawned).not.toHaveBeenCalled();
  });

  it("renders --ai pictures with no key, prints AS-FAKE-1, leaves drafts", async () => {
    const r = await run(["render", "asset-job.json", "--ai"], {
      ASSET_STUDIO_FAKE_PROVIDERS: "1",
    });
    expect(r.err).toContain(NOTICE);
    expect(r.err).not.toContain("AS-AI-1");
    expect(r.code).toBe(0);
    expect(r.err.split(NOTICE).length - 1).toBe(1);
    expect(stored().some((f) => f.endsWith(".webp"))).toBe(true);
    expect(spawned).not.toHaveBeenCalled();
  });

  it("without the variable a voiced line still fails AS-VOICE-1", async () => {
    const r = await run(["render", "asset-job.json"], {});
    expect(r.err).toContain("AS-VOICE-1");
    expect(r.err).not.toContain("AS-FAKE-1");
    expect(r.code).not.toBe(0);
  });

  it("any value other than 1 leaves real providers in place", async () => {
    const r = await run(["render", "asset-job.json"], {
      ASSET_STUDIO_FAKE_PROVIDERS: "true",
    });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("AS-VOICE-1");
    expect(r.err).not.toContain("AS-FAKE-1");
  });

  it("the fake tone is deterministic and its length tracks the text", async () => {
    const p = createFakeTtsProvider();
    const a = await p.synthesize({ text: "hi", voiceId: "v" });
    const b = await p.synthesize({ text: "hi", voiceId: "v" });
    const c = await p.synthesize({ text: "hi there, friend", voiceId: "v" });
    expect(Buffer.from(a.audio).equals(Buffer.from(b.audio))).toBe(true);
    expect(parseWav(c.audio).frames).toBeGreaterThan(parseWav(a.audio).frames);
  });

  describe("fake ledger", () => {
    const FAKE = { ASSET_STUDIO_FAKE_PROVIDERS: "1" };
    const withSound = (): void => {
      writeFileSync(join(dir, "door.m4a"), TINY_M4A);
      job.sounds = [
        { id: "sound.door", kind: "effect", source: "door.m4a" },
      ] as Job["sounds"];
    };
    afterEach(() => {
      job.sounds = [];
      clearRenderers();
      registerRenderer(pictureRenderer);
      registerRenderer(createVoiceRenderer());
      registerRenderer(createAiRenderer());
    });
    const useReal = () => {
      const inner = createFakeImageProvider();
      const image = {
        id: "real-image",
        model: "real-1",
        calls: inner.calls,
        generate: (req: Parameters<typeof inner.generate>[0]) =>
          inner.generate({ ...req, prompt: "different pixels" }),
      };
      const tts = fakeProvider("gemini-tts");
      clearRenderers();
      registerRenderer(pictureRenderer);
      registerRenderer(createAiRenderer({ provider: () => image }));
      registerRenderer(
        createVoiceRenderer({
          providers: providerRegistry({ "gemini-tts": () => tts }),
          converter: {
            wavToM4a: async () => TINY_M4A,
            durationSeconds: async () => 7.5,
          },
        }),
      );
      return { image, tts };
    };
    const index = (): Record<string, { file: string; size: unknown }> =>
      JSON.parse(readFileSync(join(work, "fakes", "index.json"), "utf8"));
    const ledger = (): string[] | null => {
      try {
        return JSON.parse(
          readFileSync(join(work, "fakes", "fake.json"), "utf8"),
        ).keys;
      } catch {
        return null;
      }
    };

    it("lists every fake asset in fake.json", async () => {
      withSound();
      const r = await run(["render", "asset-job.json", "--ai"], FAKE);
      expect(r.code).toBe(0);
      expect(ledger()).toEqual(
        ["line.one", "painting.hall", "sound.door"].sort(),
      );
    });

    it("a real --ai run after a fake one asks the real provider and replaces the entry", async () => {
      await run(["render", "asset-job.json", "--ai"], FAKE);
      const fakeFile = index()["painting.hall"]?.file;
      const { image } = useReal();
      const r = await run(["render", "asset-job.json", "--ai"], {
        GEMINI_API_KEY: "k",
      });
      expect(r.code).toBe(0);
      expect(image.calls.length).toBeGreaterThan(0);
      expect(index()["painting.hall"]?.file).not.toBe(fakeFile);
      expect(ledger()).toBeNull();
    });

    it("a real run after a fake one measures the sound for real", async () => {
      withSound();
      await run(["render", "asset-job.json"], FAKE);
      expect(index()["sound.door"]?.size).toEqual({ seconds: 1.5 });
      useReal();
      const r = await run(["render", "asset-job.json"], {});
      expect(r.code).toBe(0);
      expect(index()["sound.door"]?.size).toEqual({ seconds: 7.5 });
      expect(ledger()).toBeNull();
    });

    it("a fake run refuses with AS-FAKE-2 when the story holds a real entry, writing nothing", async () => {
      useReal();
      const real = await run(["render", "asset-job.json"], {
        GEMINI_API_KEY: "k",
      });
      expect(real.code).toBe(0);
      const before = readFileSync(join(work, "fakes", "index.json"), "utf8");
      const r = await run(["render", "asset-job.json"], FAKE);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("AS-FAKE-2");
      expect(r.err).toContain("fakes");
      expect(readFileSync(join(work, "fakes", "index.json"), "utf8")).toBe(
        before,
      );
      expect(ledger()).toBeNull();
    });

    it("approving a placeholder works and warns AS-FAKE-3", async () => {
      await run(["render", "asset-job.json"], FAKE);
      const r = await run(["approve", "asset-job.json", "line.one"], FAKE);
      expect(r.code).toBe(0);
      expect(r.out).toContain("line.one: final");
      expect(r.err).toContain("AS-FAKE-3");
    });
  });
});
