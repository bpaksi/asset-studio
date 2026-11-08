import { describe, expect, it } from "vitest";

import { createGeminiProvider, geminiFromEnv } from "./gemini.js";
import { parseWav } from "./wav.js";

const pcm = Buffer.alloc(480, 7);
const b64 = pcm.toString("base64");

function mockFetch(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("Gemini adapter", () => {
  it("uses the Interactions API for 3.8 models and wraps PCM as WAV", async () => {
    const m = mockFetch({
      steps: [{ content: [{ type: "audio", data: b64 }] }],
    });
    const p = createGeminiProvider({
      apiKey: "k",
      model: "gemini-3.8-flash-tts",
      fetch: m.impl,
    });
    const out = await p.synthesize({
      text: "Hello.",
      voiceId: "Charon",
      style: "calm",
    });
    const call = m.calls[0];
    expect(call?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    expect(
      (call?.init.headers as Record<string, string> | undefined)?.[
        "x-goog-api-key"
      ],
    ).toBe("k");
    const content = call?.body.input[0].content[0];
    expect(content.text).toBe("Hello.");
    expect(content.annotations).toEqual([
      { type: "speech_metadata", style: "calm" },
    ]);
    expect(call?.body.generation_config.speech_config).toEqual([
      { voice: "Charon" },
    ]);
    expect(out.format).toBe("wav");
    expect(out.sampleRate).toBe(24000);
    const wav = parseWav(out.audio);
    expect(wav.frames).toBe(240);
    expect(Buffer.from(wav.pcm16).equals(pcm)).toBe(true);
  });

  it("uses generateContent for older models; style is prompt text; rate from the mime type", async () => {
    const m = mockFetch({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { data: b64, mimeType: "audio/L16;rate=16000" } },
            ],
          },
        },
      ],
    });
    const p = createGeminiProvider({
      apiKey: "k",
      model: "gemini-2.5-flash-preview-tts",
      fetch: m.impl,
    });
    const out = await p.synthesize({
      text: "Hello.",
      voiceId: "Kore",
      style: "stern",
    });
    expect(m.calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
    );
    expect(m.calls[0]?.body.contents[0].parts[0].text).toBe(
      "stern. Say the following:\nHello.",
    );
    expect(
      m.calls[0]?.body.generationConfig.speechConfig.voiceConfig
        .prebuiltVoiceConfig.voiceName,
    ).toBe("Kore");
    expect(out.sampleRate).toBe(16000);
    expect(parseWav(out.audio).sampleRate).toBe(16000);
  });

  it("passes through audio that is already a WAV", async () => {
    const { pcmToWav } = await import("./wav.js");
    const wav = pcmToWav(pcm, 24000, 1);
    const m = mockFetch({
      steps: [
        {
          content: [
            { type: "audio", data: Buffer.from(wav).toString("base64") },
          ],
        },
      ],
    });
    const p = createGeminiProvider({ apiKey: "k", fetch: m.impl });
    const out = await p.synthesize({ text: "x", voiceId: "Kore" });
    expect(Buffer.from(out.audio).equals(Buffer.from(wav))).toBe(true);
  });

  it("fails on an HTTP error and on a reply with no audio, without the key", async () => {
    const bad = createGeminiProvider({
      apiKey: "SECRET",
      fetch: mockFetch({ error: { message: "quota" } }, 429).impl,
    });
    await expect(
      bad.synthesize({ text: "x", voiceId: "Kore" }),
    ).rejects.toThrow(/quota/);
    const empty = createGeminiProvider({
      apiKey: "SECRET",
      fetch: mockFetch({ steps: [] }).impl,
    });
    const error = await empty
      .synthesize({ text: "x", voiceId: "Kore" })
      .catch((e: Error) => e);
    expect((error as Error).message).toMatch(/no audio/);
    expect((error as Error).message).not.toContain("SECRET");
  });

  it("geminiFromEnv fails AS-VOICE-1 without a key", () => {
    expect(() => geminiFromEnv({})).toThrow(/GEMINI_API_KEY/);
    try {
      geminiFromEnv({ GEMINI_API_KEY: " " });
    } catch (e) {
      expect((e as { code: string }).code).toBe("AS-VOICE-1");
    }
  });
});
