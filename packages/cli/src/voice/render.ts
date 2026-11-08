import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";

import {
  audioSplicePlan,
  captionOnlyLine,
  estimateLineSeconds,
  type Job,
  type JobLine,
  MAX_LINE_SECONDS,
  PauseMarkupError,
  type SilencePcm,
  type SpeechPcm,
  splicePcm16,
  ttsCacheMaterial,
} from "@asset-studio/formats";

import type { CommandContext } from "../bin/registry.js";
import { CliError } from "../config/errors.js";
import {
  type Renderer,
  type RenderOutcome,
  registerRenderer,
} from "../render/registry.js";
import {
  putFile,
  recordDraft,
  sha256,
  type WorkPaths,
} from "../store/store.js";
import { geminiFromEnv } from "../tts/gemini.js";
import {
  providerRegistry,
  type TtsProvider,
  type TtsProviderRegistry,
} from "../tts/provider.js";
import { parseWav, pcmToWav } from "../tts/wav.js";
import { type AudioConverter, afconvertConverter } from "./audio.js";

export type VoiceDeps = {
  providers: TtsProviderRegistry;
  converter: AudioConverter;
};

export const defaultVoiceDeps = (): VoiceDeps => ({
  providers: providerRegistry({
    "gemini-tts": (env) => geminiFromEnv(env),
    gemini: (env) => geminiFromEnv(env),
  }),
  converter: afconvertConverter,
});

/** Remove the secret from text before it can reach a log or a file. */
const redactor = (env: Readonly<Record<string, string | undefined>>) => {
  const key = env.GEMINI_API_KEY;
  return (text: string): string =>
    key === undefined || key === "" ? text : text.split(key).join("[redacted]");
};

const writeAtomic = (path: string, data: Uint8Array | string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
};

const fail = (code: string, message: string): never => {
  throw new CliError(code, message);
};

/** Checks that need no network. Throws a CliError naming the rule. */
function preflight(
  line: JobLine,
  job: Job,
  deps: VoiceDeps,
): { provider: string; voiceId: string; style?: string } {
  const voice = job.cast.find((m) => m.id === line.speaker)?.voice;
  if (voice === undefined) {
    return fail("AS-VOICE-2", `speaker "${line.speaker}" has no voice.`);
  }
  try {
    const plan = audioSplicePlan(line.text);
    const total = plan.reduce(
      (sum, step) => sum + (step.type === "silence" ? step.seconds : 0),
      0,
    );
    if (!plan.some((step) => step.type === "speech") && total === 0) {
      return fail(
        "AS-VOICE-10",
        "line has no spoken text and no pause, so it would be a 0 s draft.",
      );
    }
    const seconds = estimateLineSeconds(line.text);
    if (seconds > MAX_LINE_SECONDS) {
      return fail(
        "AS-VOICE-5",
        `estimated ${seconds.toFixed(2)} s is over the ${MAX_LINE_SECONDS} s limit.`,
      );
    }
  } catch (error) {
    if (error instanceof PauseMarkupError) {
      return fail("AS-VOICE-2", error.message);
    }
    throw error;
  }
  if (!deps.providers.has(voice.provider)) {
    return fail("AS-VOICE-3", `unknown voice provider "${voice.provider}".`);
  }
  const result: { provider: string; voiceId: string; style?: string } = {
    provider: voice.provider,
    voiceId: voice.voiceId,
  };
  if (voice.style !== undefined) result.style = voice.style;
  return result;
}

/** A WAV that cannot be read is AS-VOICE-6. */
function decode(wav: Uint8Array): ReturnType<typeof parseWav> {
  try {
    return parseWav(wav);
  } catch (error) {
    return fail(
      "AS-VOICE-6",
      `cannot decode audio: ${(error as Error).message}`,
    );
  }
}

async function renderLine(
  line: JobLine,
  voice: { provider: string; voiceId: string; style?: string },
  provider: TtsProvider,
  paths: WorkPaths,
  deps: VoiceDeps,
): Promise<void> {
  const cacheDir = join(paths.root, "tts-cache");
  const parts: (SpeechPcm | SilencePcm)[] = [];
  let format: string | undefined;
  for (const step of audioSplicePlan(line.text)) {
    if (step.type === "silence") {
      parts.push({ type: "silence", seconds: step.seconds });
      continue;
    }
    const material: {
      text: string;
      provider: string;
      voiceId: string;
      style?: string;
    } = {
      text: step.text,
      provider: voice.provider,
      voiceId: voice.voiceId,
    };
    if (voice.style !== undefined) material.style = voice.style;
    const cacheFile = join(
      cacheDir,
      `${sha256(`${ttsCacheMaterial(material)}|model=${provider.model ?? ""}`)}.wav`,
    );
    let wav: Uint8Array;
    if (existsSync(cacheFile)) {
      wav = readFileSync(cacheFile);
    } else {
      const request: { text: string; voiceId: string; style?: string } = {
        text: step.text,
        voiceId: voice.voiceId,
      };
      if (voice.style !== undefined) request.style = voice.style;
      const reply = await provider.synthesize(request);
      if (reply.format !== "wav") {
        return fail(
          "AS-VOICE-6",
          `provider returned ${reply.format}; only WAV PCM can be spliced.`,
        );
      }
      if (format !== undefined && format !== reply.format) {
        return fail("AS-VOICE-6", "segments disagree on audio format.");
      }
      wav = reply.audio;
      const probe = decode(wav);
      if (
        probe.sampleRate !== reply.sampleRate ||
        probe.channels !== reply.channels
      ) {
        return fail(
          "AS-VOICE-6",
          "audio does not match the sample rate or channels the provider reported.",
        );
      }
      writeAtomic(cacheFile, wav);
    }
    format = "wav";
    const decoded = decode(wav);
    parts.push({
      type: "speech",
      pcm16: decoded.pcm16,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
    });
  }

  let spliced: ReturnType<typeof splicePcm16>;
  try {
    spliced = splicePcm16(parts);
  } catch (error) {
    return fail("AS-VOICE-6", (error as Error).message);
  }
  const master = pcmToWav(spliced.pcm16, spliced.sampleRate, spliced.channels);
  const frames = spliced.pcm16.byteLength / (2 * spliced.channels);
  const m4a = await deps.converter.wavToM4a(master);

  writeAtomic(join(paths.root, "masters", `${line.id}.wav`), master);
  recordDraft(paths, {
    id: line.id,
    kind: "line",
    data: m4a,
    ext: "m4a",
    size: { seconds: frames / spliced.sampleRate },
    inputs: {
      kind: "line",
      text: line.text,
      provider: voice.provider,
      voiceId: voice.voiceId,
      style: voice.style ?? null,
      model: provider.model ?? null,
    },
  });
  // A good render replaces an earlier caption-only record.
  rmSync(join(paths.root, "captions", `${line.id}.json`), { force: true });
}

async function renderSound(
  ctx: CommandContext,
  sound: Job["sounds"][number],
  paths: WorkPaths,
  deps: VoiceDeps,
): Promise<void> {
  const path = isAbsolute(sound.source)
    ? sound.source
    : resolve(ctx.cwd, sound.source);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return fail(
      "AS-VOICE-8",
      `cannot read sound source ${sound.source}: ${(error as Error).message}`,
    );
  }
  const ext = extname(path).slice(1).toLowerCase();
  if (!/^[a-z0-9]+$/.test(ext)) {
    return fail("AS-VOICE-8", `sound source ${sound.source} has no extension.`);
  }
  let seconds: number;
  if (ext === "wav") {
    try {
      const wav = parseWav(bytes);
      seconds = wav.frames / wav.sampleRate;
    } catch (error) {
      return fail(
        "AS-VOICE-8",
        `sound source ${sound.source} is not readable audio: ${(error as Error).message}`,
      );
    }
  } else {
    seconds = await deps.converter.durationSeconds(bytes, ext);
  }
  putFile(paths.store, bytes, ext); // validates the extension and the bytes
  recordDraft(paths, {
    id: sound.id,
    kind: sound.kind,
    data: bytes,
    ext,
    size: { seconds },
    inputs: { kind: sound.kind, sourceHash: sha256(bytes), ext },
  });
}

export function createVoiceRenderer(
  deps: VoiceDeps = defaultVoiceDeps(),
): Renderer {
  return {
    kind: "voice",
    async render(ctx, job, paths): Promise<RenderOutcome> {
      const redact = redactor(ctx.env);
      let rendered = 0;
      let failed = 0;
      const report = (id: string, error: unknown): void => {
        const code = error instanceof CliError ? error.code : "AS-VOICE-9";
        const message = redact(
          error instanceof Error ? error.message : String(error),
        );
        ctx.stderr(`${code}: ${id}: ${message}\n`);
        failed += 1;
      };
      const providers = new Map<string, TtsProvider>();

      for (const line of job.lines) {
        let voice: ReturnType<typeof preflight>;
        try {
          voice = preflight(line, job, deps);
        } catch (error) {
          report(line.id, error);
          continue;
        }
        try {
          let provider = providers.get(voice.provider);
          if (provider === undefined) {
            provider = deps.providers.create(voice.provider, ctx.env);
            providers.set(voice.provider, provider);
          }
          if (
            provider.voices !== undefined &&
            !provider.voices.includes(voice.voiceId)
          ) {
            fail(
              "AS-VOICE-4",
              `unknown voice "${voice.voiceId}" for provider "${voice.provider}".`,
            );
          }
        } catch (error) {
          // Missing key (AS-VOICE-1) or unknown voice: nothing was called.
          report(line.id, error);
          continue;
        }
        try {
          await renderLine(
            line,
            voice,
            providers.get(voice.provider) as TtsProvider,
            paths,
            deps,
          );
          rendered += 1;
        } catch (error) {
          report(line.id, error);
          // Caption-only: text, fallback words, audio null, no cues. The index
          // entry stays as it was (missing, or the earlier good draft).
          try {
            writeAtomic(
              join(paths.root, "captions", `${line.id}.json`),
              `${JSON.stringify(captionOnlyLine(line.id, line.text), null, 2)}\n`,
            );
          } catch (writeError) {
            report(line.id, writeError);
          }
        }
      }

      for (const sound of job.sounds) {
        try {
          await renderSound(ctx, sound, paths, deps);
          rendered += 1;
        } catch (error) {
          report(sound.id, error);
        }
      }
      return { rendered, failed };
    },
  };
}

registerRenderer(createVoiceRenderer());
