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
import { captionOnlyLine, type Job } from "@asset-studio/formats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../bin/cli.js";
import type { RenderOutcome } from "../render/registry.js";
import { clearRenderers, registerRenderer } from "../render/registry.js";
import { readIndex, readNotes, workPaths } from "../store/store.js";
import { providerRegistry } from "../tts/provider.js";
import { pcmToWav } from "../tts/wav.js";
import { afconvertConverter } from "./audio.js";
import { createVoiceRenderer, type VoiceDeps } from "./render.js";
import {
  fakeProvider,
  makeCtx,
  makeJob,
  stubConverter,
  TINY_M4A,
} from "./test-helpers.js";

let dir: string;
let work: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "as-voice-")));
  work = join(dir, "work");
  mkdirSync(work);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SAMPLE = "Welcome. [pause 0.5] Follow me.";

function deps(...providers: ReturnType<typeof fakeProvider>[]): VoiceDeps {
  return {
    providers: providerRegistry(
      Object.fromEntries(providers.map((p) => [p.id, () => p])),
    ),
    converter: stubConverter,
  };
}

async function run(job: Job, d: VoiceDeps, env = {}) {
  const ctx = makeCtx(dir, work, env);
  const paths = workPaths(work, job.story);
  const outcome = await createVoiceRenderer(d).render(ctx, job, paths, {
    jobPath: join(dir, "job.json"),
    jobDir: dir,
    ai: false,
  });
  return { ctx, paths, outcome: outcome as RenderOutcome };
}

const masterOf = (root: string, id: string) =>
  readFileSync(join(root, "masters", `${id}.wav`));

function allFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allFiles(join(root, e.name)) : [join(root, e.name)],
  );
}

describe("P2-04a: WAV master, m4a draft, AS-VOICE-1, no secret", () => {
  it("writes a PCM WAV master and an m4a draft with seconds from the frames", async () => {
    const fake = fakeProvider("fake-a", { framesFor: () => 4800 });
    const { paths, outcome } = await run(
      makeJob([{ id: "line.intro", text: "Hello there." }]),
      deps(fake),
    );
    expect(outcome).toEqual({ rendered: 1, failed: 0 });
    const wav = masterOf(paths.root, "line.intro");
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    const entry = readIndex(paths)["line.intro"];
    expect(entry?.status).toBe("draft");
    expect(entry?.kind).toBe("line");
    expect(entry?.file).toMatch(/^[0-9a-f]{64}\.m4a$/);
    expect(entry?.size).toEqual({ seconds: 4800 / 24000 });
    expect(readFileSync(join(paths.store, entry?.file ?? ""))).toEqual(
      Buffer.from(TINY_M4A),
    );
  });

  it("fails AS-VOICE-1 for a missing GEMINI_API_KEY and calls nothing", async () => {
    let fetched = 0;
    const real = deps();
    real.providers = providerRegistry({
      "gemini-tts": () => {
        throw new (class extends Error {})("unused");
      },
    });
    // Use the real Gemini factory with a counting fetch.
    const { geminiFromEnv } = await import("../tts/gemini.js");
    real.providers = providerRegistry({
      "gemini-tts": (env) =>
        geminiFromEnv(env, (async () => {
          fetched += 1;
          return new Response("{}");
        }) as typeof fetch),
    });
    const { ctx, paths, outcome } = await run(
      makeJob([{ id: "line.intro", text: "Hello." }], {
        provider: "gemini-tts",
        voiceId: "Charon",
      }),
      real,
      {},
    );
    expect(outcome.failed).toBe(1);
    expect(ctx.err).toContain("AS-VOICE-1: line.intro");
    expect(fetched).toBe(0);
    expect(readIndex(paths)["line.intro"]).toBeUndefined();
  });

  it("never writes the key to logs, index, notes or store, even when the provider echoes it", async () => {
    const SECRET = "FAKE-KEY-s3cr3t-9f8e7d";
    const good = fakeProvider("fake-a");
    const echo = fakeProvider("fake-b", {
      fail: () => new Error(`request failed with key ${SECRET}`),
    });
    const job = makeJob([{ id: "line.ok", text: "Fine." }]);
    job.cast.push({
      id: "echo",
      name: "Echo",
      voice: { provider: "fake-b", voiceId: "V" },
      moods: [],
    } as Job["cast"][number]);
    job.lines.push({ id: "line.bad", speaker: "echo", text: "Boom." });
    const { ctx, paths } = await run(job, deps(good, echo), {
      GEMINI_API_KEY: SECRET,
    });
    expect(ctx.err).toContain("line.bad");
    expect(ctx.err).not.toContain(SECRET);
    expect(ctx.out).not.toContain(SECRET);
    for (const file of allFiles(paths.root)) {
      expect(readFileSync(file).includes(SECRET), file).toBe(false);
    }
    expect(JSON.stringify(readNotes(paths))).not.toContain(SECRET);
  });
});

describe("P2-04b: pauses", () => {
  it("calls the provider twice with exactly the spoken segments; style is separate", async () => {
    const fake = fakeProvider("fake-a", { framesFor: () => 2400 });
    const { paths } = await run(
      makeJob([{ id: "line.intro", text: SAMPLE }]),
      deps(fake),
    );
    expect(fake.calls).toEqual([
      { text: "Welcome.", voiceId: "Voice-A", style: "calm" },
      { text: "Follow me.", voiceId: "Voice-A", style: "calm" },
    ]);
    for (const call of fake.calls) {
      expect(call.text).not.toContain("[pause");
      expect(call.text).not.toContain("calm");
    }
    const wav = masterOf(paths.root, "line.intro");
    const pcm = wav.subarray(44);
    const silent = Math.round(0.5 * 24000);
    expect(pcm.length / 2).toBe(2400 + silent + 2400);
    const gap = pcm.subarray(2400 * 2, (2400 + silent) * 2);
    expect(gap.every((b) => b === 0)).toBe(true);
    expect(pcm.subarray(0, 2400 * 2).some((b) => b !== 0)).toBe(true);
    expect(readIndex(paths)["line.intro"]?.size).toEqual({
      seconds: (2400 + silent + 2400) / 24000,
    });
  });

  it("uses 22050 Hz mono for a pause-only line and makes no TTS call", async () => {
    const fake = fakeProvider("fake-a");
    const { paths, outcome } = await run(
      makeJob([{ id: "line.quiet", text: "[pause 1.5]" }]),
      deps(fake),
    );
    expect(outcome.failed).toBe(0);
    expect(fake.calls).toHaveLength(0);
    const wav = masterOf(paths.root, "line.quiet");
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect((wav.length - 44) / 2).toBe(Math.round(1.5 * 22050));
  });

  it("pause 0 inserts no frames", async () => {
    const fake = fakeProvider("fake-a", { framesFor: () => 100 });
    const { paths } = await run(
      makeJob([{ id: "line.zero", text: "One. [pause 0] Two." }]),
      deps(fake),
    );
    expect((masterOf(paths.root, "line.zero").length - 44) / 2).toBe(200);
  });

  it("blank text and a zero-length pause-only line fail AS-VOICE-10 with no call", async () => {
    for (const text of ["   ", "[pause 0]"]) {
      const fake = fakeProvider("fake-a");
      const { ctx, paths, outcome } = await run(
        makeJob([{ id: "line.blank", text }]),
        deps(fake),
      );
      expect(fake.calls).toHaveLength(0);
      expect(outcome).toEqual({ rendered: 0, failed: 1 });
      expect(ctx.err).toContain("AS-VOICE-10: line.blank");
      expect(readIndex(paths)["line.blank"]).toBeUndefined();
    }
  });
});

describe("P2-04c: cache", () => {
  const base = { provider: "fake-a", voiceId: "Voice-A", style: "calm" };
  const first = async (
    voice: typeof base,
    text = "Hello.",
    ps = [fakeProvider("fake-a"), fakeProvider("fake-b")],
  ) => {
    const d = deps(...ps);
    const job = makeJob([{ id: "line.c", text }], voice);
    await run(job, d);
    return { ps, d };
  };

  it("a hit skips the API", async () => {
    const { ps, d } = await first(base);
    expect(ps[0]?.calls).toHaveLength(1);
    await run(makeJob([{ id: "line.c", text: "Hello." }], base), d);
    expect(ps[0]?.calls).toHaveLength(1);
  });

  it.each([
    ["text", { text: "Goodbye." }],
    ["provider", { voice: { ...base, provider: "fake-b" } }],
    ["voiceId", { voice: { ...base, voiceId: "Voice-B" } }],
    ["style", { voice: { ...base, style: "stern" } }],
  ])("changing %s misses the cache", async (_name, change) => {
    const { ps, d } = await first(base);
    const before = ps.reduce((n, p) => n + p.calls.length, 0);
    const c = change as { text?: string; voice?: typeof base };
    await run(
      makeJob([{ id: "line.c", text: c.text ?? "Hello." }], c.voice ?? base),
      d,
    );
    expect(ps.reduce((n, p) => n + p.calls.length, 0)).toBe(before + 1);
  });

  it("a changed line gets a new draft and keeps the old file", async () => {
    const one = fakeProvider("fake-a", { framesFor: () => 1200 });
    const first = await run(
      makeJob([{ id: "line.c", text: "Hello." }]),
      deps(one),
    );
    const old = readIndex(first.paths)["line.c"];
    const oldPath = join(first.paths.store, old?.file ?? "");
    const oldBytes = readFileSync(oldPath);
    // A different converter output stands in for different audio.
    const d = deps(fakeProvider("fake-a"));
    const other = new Uint8Array([...TINY_M4A, 0]);
    d.converter = { ...stubConverter, wavToM4a: async () => other };
    await run(makeJob([{ id: "line.c", text: "Changed." }]), d);
    const now = readIndex(first.paths)["line.c"];
    expect(now?.status).toBe("draft");
    expect(now?.file).not.toBe(old?.file);
    expect(now?.inputsHash).not.toBe(old?.inputsHash);
    expect(readFileSync(join(first.paths.store, now?.file ?? ""))).toEqual(
      Buffer.from(other),
    );
    expect(readFileSync(oldPath)).toEqual(oldBytes);
  });

  it("changing the provider model misses the cache and the inputs hash", async () => {
    const a = { ...fakeProvider("fake-a"), model: "m1" };
    const b = fakeProvider("fake-a");
    (b as { model?: string }).model = "m2";
    const job = makeJob([{ id: "line.c", text: "Hello." }]);
    const first = await run(job, deps(a));
    const h1 = readIndex(first.paths)["line.c"]?.inputsHash;
    await run(job, deps(a));
    expect(a.calls).toHaveLength(1);
    await run(job, deps(b));
    expect(b.calls).toHaveLength(1);
    expect(readIndex(first.paths)["line.c"]?.inputsHash).not.toBe(h1);
  });
});

describe("P2-04d: failures are caption-only", () => {
  it("a failed segment writes captions/<id>.json, no master, no failover; later lines run", async () => {
    const a = fakeProvider("fake-a", {
      fail: (t) => (t === "Follow me." ? new Error("quota") : undefined),
    });
    const b = fakeProvider("fake-b");
    const job = makeJob([
      { id: "line.bad", text: SAMPLE },
      { id: "line.good", text: "All fine." },
    ]);
    const { ctx, paths, outcome } = await run(job, deps(a, b));
    expect(outcome).toEqual({ rendered: 1, failed: 1 });
    expect(b.calls).toHaveLength(0);
    expect(existsSync(join(paths.root, "masters", "line.bad.wav"))).toBe(false);
    expect(readIndex(paths)["line.bad"]).toBeUndefined();
    expect(readIndex(paths)["line.good"]?.status).toBe("draft");
    expect(ctx.err).toContain("AS-VOICE-9: line.bad: quota");
    const captions = JSON.parse(
      readFileSync(join(paths.root, "captions", "line.bad.json"), "utf8"),
    );
    expect(captions).toEqual(captionOnlyLine("line.bad", SAMPLE));
    expect(captions.audio).toBeNull();
    expect(captions.cues).toEqual([]);
    expect(captions.captionTiming).toBe("fallback");
  });

  it("mismatched segment sample rates make the line caption-only", async () => {
    let n = 0;
    const p = fakeProvider("fake-a");
    const original = p.synthesize.bind(p);
    p.synthesize = async (req) => {
      const reply = await original(req);
      n += 1;
      if (n === 2) {
        const w = pcmToWav(new Uint8Array(200), 16000, 1);
        return { audio: w, format: "wav", sampleRate: 16000, channels: 1 };
      }
      return reply;
    };
    const { ctx, paths, outcome } = await run(
      makeJob([{ id: "line.m", text: SAMPLE }]),
      deps(p),
    );
    expect(outcome.failed).toBe(1);
    expect(ctx.err).toContain("AS-VOICE-6: line.m");
    expect(existsSync(join(paths.root, "captions", "line.m.json"))).toBe(true);
    expect(existsSync(join(paths.root, "masters", "line.m.wav"))).toBe(false);
  });

  it("a non-WAV format and a decode failure are caption-only", async () => {
    for (const [name, opts] of [
      ["ogg", { format: "ogg" as const }],
      ["garbage", { garbage: () => true }],
    ] as const) {
      const p = fakeProvider("fake-a", opts);
      const { outcome, paths } = await run(
        makeJob([{ id: `line.${name}`, text: "Text." }]),
        deps(p),
      );
      expect(outcome.failed, name).toBe(1);
      expect(
        existsSync(join(paths.root, "captions", `line.${name}.json`)),
      ).toBe(true);
      expect(readIndex(paths)[`line.${name}`]).toBeUndefined();
    }
  });

  it("garbage, truncated and header-mismatched audio fail AS-VOICE-6", async () => {
    const good = pcmToWav(new Uint8Array(400), 24000, 1);
    const cases: [string, Uint8Array, number][] = [
      ["garbage", new Uint8Array([1, 2, 3, 4]), 24000],
      ["truncated", good.subarray(0, good.length - 100), 24000],
      ["mismatch", good, 16000], // header says 24000, provider reported 16000
    ];
    for (const [name, audio, rate] of cases) {
      const p = fakeProvider("fake-a");
      p.synthesize = async () => ({
        audio,
        format: "wav",
        sampleRate: rate,
        channels: 1,
      });
      const { ctx, paths, outcome } = await run(
        makeJob([{ id: `line.${name}`, text: "Text." }]),
        deps(p),
      );
      expect(outcome.failed, name).toBe(1);
      expect(ctx.err, name).toContain(`AS-VOICE-6: line.${name}`);
      expect(
        existsSync(join(paths.root, "captions", `line.${name}.json`)),
        name,
      ).toBe(true);
      expect(existsSync(join(paths.root, "masters", `line.${name}.wav`))).toBe(
        false,
      );
    }
  });

  it("a channel-count mismatch fails AS-VOICE-6", async () => {
    const p = fakeProvider("fake-a");
    p.synthesize = async () => ({
      audio: pcmToWav(new Uint8Array(400), 24000, 1),
      format: "wav",
      sampleRate: 24000,
      channels: 2,
    });
    const { ctx } = await run(
      makeJob([{ id: "line.ch", text: "T." }]),
      deps(p),
    );
    expect(ctx.err).toContain("AS-VOICE-6: line.ch");
  });

  it("a converter failure is caption-only and leaves no master", async () => {
    const d = deps(fakeProvider("fake-a"));
    d.converter = {
      ...stubConverter,
      wavToM4a: async () => {
        throw new Error("afconvert exploded");
      },
    };
    const { ctx, paths, outcome } = await run(
      makeJob([{ id: "line.x", text: "Text." }]),
      d,
    );
    expect(outcome.failed).toBe(1);
    expect(ctx.err).toContain("line.x");
    expect(existsSync(join(paths.root, "masters", "line.x.wav"))).toBe(false);
  });

  it("a failed re-render leaves the earlier good draft intact", async () => {
    const good = fakeProvider("fake-a");
    const job = makeJob([{ id: "line.k", text: "First." }]);
    const { paths } = await run(job, deps(good));
    const before = readIndex(paths)["line.k"];
    const bad = fakeProvider("fake-a", { fail: () => new Error("down") });
    await run(makeJob([{ id: "line.k", text: "Second." }]), deps(bad));
    expect(readIndex(paths)["line.k"]).toEqual(before);
  });

  it("render --only voice ends non-zero with the failed count", async () => {
    clearRenderers();
    registerRenderer(
      createVoiceRenderer(
        deps(fakeProvider("fake-a", { fail: () => new Error("down") })),
      ),
    );
    const jobPath = join(dir, "job.json");
    writeFileSync(
      jobPath,
      JSON.stringify(makeJob([{ id: "line.z", text: "Hi." }])),
    );
    let out = "";
    let err = "";
    const code = await main(
      ["--work-folder", work, "render", jobPath, "--only", "voice"],
      {
        env: {
          PATH: process.env.PATH,
          ASSET_STUDIO_CONFIG_DIR: join(dir, "c"),
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
    clearRenderers();
    expect(code).toBe(1);
    expect(out).toContain("rendered 0, failed 1");
    expect(err).toContain("AS-RENDER-2: 1 failed.");
    expect(err).toContain("line.z");
  });
});

describe("S4 edges: preflight before any call", () => {
  it.each([
    "Bad [pause] marker",
    "Bad [pause -1] marker",
    "Bad [pause abc] marker",
    "Bad [Pause 1] marker",
    "Bad [pause 1 marker",
  ])("rejects invalid pause %j with AS-VOICE-2 and no call", async (text) => {
    const fake = fakeProvider("fake-a");
    const { ctx, outcome } = await run(
      makeJob([{ id: "line.p", text }]),
      deps(fake),
    );
    expect(outcome.failed).toBe(1);
    expect(ctx.err).toContain("AS-VOICE-2: line.p");
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects an unknown provider with AS-VOICE-3", async () => {
    const fake = fakeProvider("fake-a");
    const { ctx } = await run(
      makeJob([{ id: "line.u", text: "Hi." }], {
        provider: "nope",
        voiceId: "V",
      }),
      deps(fake),
    );
    expect(ctx.err).toContain("AS-VOICE-3: line.u");
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects an unknown voice with AS-VOICE-4", async () => {
    const fake = fakeProvider("fake-a", { voices: ["Known"] });
    const { ctx } = await run(
      makeJob([{ id: "line.v", text: "Hi." }], {
        provider: "fake-a",
        voiceId: "Stranger",
      }),
      deps(fake),
    );
    expect(ctx.err).toContain("AS-VOICE-4: line.v");
    expect(fake.calls).toHaveLength(0);
  });

  it("20 s exactly passes; just over is rejected with no call", async () => {
    const ok = fakeProvider("fake-a");
    const exact = await run(
      makeJob([{ id: "line.max", text: "a".repeat(250) }]),
      deps(ok),
    );
    expect(exact.outcome.failed).toBe(0);
    expect(ok.calls).toHaveLength(1);

    const over = fakeProvider("fake-a");
    const r = await run(
      makeJob([{ id: "line.over", text: "a".repeat(251) }]),
      deps(over),
    );
    expect(r.ctx.err).toContain("AS-VOICE-5: line.over");
    expect(over.calls).toHaveLength(0);
    // pauses count toward the estimate
    const paused = await run(
      makeJob([{ id: "line.pz", text: "a [pause 20]" }]),
      deps(over),
    );
    expect(paused.ctx.err).toContain("AS-VOICE-5: line.pz");
    expect(over.calls).toHaveLength(0);
  });
});

describe("job sounds", () => {
  it("copies a WAV source into the store as a draft with seconds", async () => {
    const pcm = new Uint8Array(24000 * 2); // 1 s mono
    pcm[10] = 5;
    const wav = pcmToWav(pcm, 24000, 1);
    mkdirSync(join(dir, "sfx"));
    writeFileSync(join(dir, "sfx", "door.wav"), wav);
    const job = makeJob([], undefined, [
      { id: "sound.door", kind: "effect", source: "sfx/door.wav" },
    ]);
    const { paths, outcome } = await run(job, deps());
    expect(outcome).toEqual({ rendered: 1, failed: 0 });
    const entry = readIndex(paths)["sound.door"];
    expect(entry?.status).toBe("draft");
    expect(entry?.kind).toBe("effect");
    expect(entry?.size).toEqual({ seconds: 1 });
    expect(entry?.file).toMatch(/\.wav$/);
    expect(readFileSync(join(paths.store, entry?.file ?? ""))).toEqual(
      Buffer.from(wav),
    );
  });

  it("measures a non-WAV source with the converter and reports a missing file", async () => {
    writeFileSync(join(dir, "bell.m4a"), TINY_M4A);
    const job = makeJob([], undefined, [
      { id: "sound.bell", kind: "effect", source: join(dir, "bell.m4a") },
      { id: "sound.gone", kind: "effect", source: "nope.wav" },
    ]);
    const { paths, outcome, ctx } = await run(job, deps());
    expect(outcome).toEqual({ rendered: 1, failed: 1 });
    expect(readIndex(paths)["sound.bell"]?.size).toEqual({ seconds: 1.5 });
    expect(ctx.err).toContain("AS-VOICE-8: sound.gone");
  });

  it("resolves a relative sound source from the job folder, not the cwd, and rejects an empty path", async () => {
    mkdirSync(join(dir, "jobs", "sfx"), { recursive: true });
    const wav = pcmToWav(new Uint8Array(48000), 24000, 1);
    writeFileSync(join(dir, "jobs", "sfx", "door.wav"), wav);
    const job = makeJob([{ id: "line.q", text: "Hi." }], undefined, [
      { id: "sound.door", kind: "effect", source: "sfx/door.wav" },
      { id: "sound.empty", kind: "effect", source: " " },
    ]);
    const jobPath = join(dir, "jobs", "job.json");
    writeFileSync(jobPath, JSON.stringify(job));
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    clearRenderers();
    registerRenderer(createVoiceRenderer(deps(fakeProvider("fake-a"))));
    let err = "";
    const code = await main(
      ["--work-folder", work, "render", "../jobs/job.json", "--only", "voice"],
      {
        env: {
          PATH: process.env.PATH,
          ASSET_STUDIO_CONFIG_DIR: join(dir, "c"),
        },
        cwd: elsewhere,
        stdout: () => {},
        stderr: (t) => {
          err += t;
        },
      },
    );
    clearRenderers();
    expect(code).toBe(1);
    expect(err).toContain("AS-VOICE-8: sound.empty");
    expect(err).not.toContain("sound.door");
    expect(readIndex(workPaths(work, job.story))["sound.door"]?.status).toBe(
      "draft",
    );
  });

  it("does not turn a final sound back into a draft on a re-render", async () => {
    writeFileSync(join(dir, "bell.m4a"), TINY_M4A);
    const job = makeJob([], undefined, [
      { id: "sound.bell", kind: "effect", source: join(dir, "bell.m4a") },
    ]);
    const { paths } = await run(job, deps());
    const index = readIndex(paths);
    const entry = index["sound.bell"];
    if (entry === undefined) throw new Error("missing");
    const { writeIndex } = await import("../store/store.js");
    writeIndex(paths, {
      ...index,
      "sound.bell": { ...entry, status: "final" },
    });
    await run(job, deps());
    expect(readIndex(paths)["sound.bell"]?.status).toBe("final");
  });
});

describe("real afconvert", () => {
  it.skipIf(process.platform !== "darwin")(
    "converts a WAV master to a playable m4a",
    async () => {
      const m4a = await afconvertConverter.wavToM4a(
        pcmToWav(new Uint8Array(24000 * 2), 24000, 1),
      );
      expect(Buffer.from(m4a).toString("ascii", 4, 8)).toBe("ftyp");
      expect(statSync(join(dir)).isDirectory()).toBe(true);
      const seconds = await afconvertConverter.durationSeconds(m4a, "m4a");
      expect(seconds).toBeGreaterThan(0.9);
      expect(seconds).toBeLessThan(1.2);
    },
  );
});
