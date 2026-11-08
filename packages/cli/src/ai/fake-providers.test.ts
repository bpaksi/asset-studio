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
import { createFakeTtsProvider } from "../tts/fake.js";
import { parseWav } from "../tts/wav.js";

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
});
