import { readFileSync } from "node:fs";

import type { Job } from "@asset-studio/formats";

import type { CommandContext } from "../bin/registry.js";
import type { TtsProvider } from "../tts/provider.js";
import { pcmToWav } from "../tts/wav.js";
import type { AudioConverter } from "./audio.js";

export const TINY_M4A = new Uint8Array(
  readFileSync(new URL("./fixtures/tiny.m4a", import.meta.url)),
);

export const stubConverter: AudioConverter = {
  wavToM4a: async () => TINY_M4A,
  durationSeconds: async () => 1.5,
};

export type Call = { text: string; voiceId: string; style?: string };

/** A fake provider: each text gets `frames` frames of a tone. */
export function fakeProvider(
  id = "fake-a",
  options: {
    sampleRate?: number;
    channels?: number;
    framesFor?: (text: string) => number;
    fail?: (text: string) => Error | undefined;
    format?: "wav" | "ogg";
    garbage?: (text: string) => boolean;
    voices?: readonly string[];
  } = {},
): TtsProvider & { calls: Call[] } {
  const calls: Call[] = [];
  const sampleRate = options.sampleRate ?? 24000;
  const channels = options.channels ?? 1;
  return {
    id,
    ...(options.voices === undefined ? {} : { voices: options.voices }),
    calls,
    async synthesize(req) {
      calls.push({ ...req });
      const failure = options.fail?.(req.text);
      if (failure !== undefined) throw failure;
      if (options.garbage?.(req.text) === true) {
        return {
          audio: new Uint8Array([1, 2, 3, 4]),
          format: "wav",
          sampleRate,
          channels,
        };
      }
      const frames = options.framesFor?.(req.text) ?? 2400;
      const pcm = Buffer.alloc(frames * channels * 2);
      for (let i = 0; i < frames * channels; i++) {
        pcm.writeInt16LE(1000 + (i % 50), i * 2); // never silent
      }
      return {
        audio: pcmToWav(pcm, sampleRate, channels),
        format: options.format ?? "wav",
        sampleRate,
        channels,
      };
    },
  };
}

export function makeJob(
  lines: { id: string; text: string }[],
  voice: { provider: string; voiceId: string; style?: string } = {
    provider: "fake-a",
    voiceId: "Voice-A",
    style: "calm",
  },
  sounds: Job["sounds"] = [],
): Job {
  return {
    schema: 1,
    story: "dracula",
    source: `sha256:${"a".repeat(64)}`,
    profiles: {},
    cast: [{ id: "keeper", name: "Keeper", voice, moods: [] }],
    lines: lines.map((l) => ({ id: l.id, speaker: "keeper", text: l.text })),
    pictures: [],
    moments: [],
    sounds,
  } as Job;
}

export function makeCtx(
  cwd: string,
  workFolder: string,
  env: Record<string, string | undefined> = {},
): CommandContext & { out: string; err: string } {
  const ctx = {
    env,
    cwd,
    workFolder,
    out: "",
    err: "",
    stdout(text: string) {
      ctx.out += text;
    },
    stderr(text: string) {
      ctx.err += text;
    },
  };
  return ctx;
}
