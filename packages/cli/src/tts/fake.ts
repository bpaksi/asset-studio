// Deterministic offline providers for CI and install checks. They make no
// network call and need no key. Their output is not real media.
import type { TtsProvider } from "./provider.js";
import { pcmToWav } from "./wav.js";

export const FAKE_ENV = "ASSET_STUDIO_FAKE_PROVIDERS";

export const FAKE_NOTICE = `AS-FAKE-1: fake providers in use (${FAKE_ENV}=1); output is not real media\n`;

/** True only for the exact value "1". */
export const fakeProvidersOn = (
  env: Readonly<Record<string, string | undefined>>,
): boolean => env[FAKE_ENV] === "1";

const RATE = 24000;

/** A tone whose length tracks the text: 0.2 s plus 0.05 s per character. */
export function createFakeTtsProvider(id = "fake-tts"): TtsProvider {
  return {
    id,
    model: "fake-1",
    async synthesize(req) {
      const frames = Math.round(RATE * (0.2 + 0.05 * req.text.length));
      const pcm = Buffer.alloc(frames * 2);
      for (let i = 0; i < frames; i++) {
        const v = Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / RATE));
        pcm.writeInt16LE(v === 0 ? 1 : v, i * 2); // never silent
      }
      return {
        audio: pcmToWav(pcm, RATE, 1),
        format: "wav",
        sampleRate: RATE,
        channels: 1,
      };
    },
  };
}

const announced = new WeakSet<object>();

/** Print the AS-FAKE-1 line once per run (the context is shared by renderers). */
export function announceFake(ctx: { stderr(text: string): void }): void {
  if (announced.has(ctx)) return;
  announced.add(ctx);
  ctx.stderr(FAKE_NOTICE);
}
