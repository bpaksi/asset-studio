// Gemini TTS client, adapted from Bloodtower's tts-explorer (logic copied,
// not imported). Two API shapes:
//  - gemini-3.8-*: Interactions API (verbatim text + speech_metadata.style)
//  - older (2.5 / 3.1 preview): generateContent; style is prompt text
import { CliError } from "../config/errors.js";
import type { TtsProvider } from "./provider.js";
import { pcmToWav } from "./wav.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiApi = "interactions" | "generateContent";

export const GEMINI_MODELS: Record<string, GeminiApi> = {
  "gemini-3.8-flash-tts": "interactions",
  "gemini-3.8-flash-lite-tts": "interactions",
  "gemini-3.1-flash-tts-preview": "generateContent",
  "gemini-2.5-pro-preview-tts": "generateContent",
  "gemini-2.5-flash-preview-tts": "generateContent",
};
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash-tts";

export const GEMINI_VOICES: readonly string[] = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
];

const PCM_RATE = 24000;

type Json = Record<string, unknown>;

export type GeminiOptions = {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
};

/** The sample rate in a mime type like `audio/L16;codec=pcm;rate=24000`. */
function rateFromMime(mime: unknown): number {
  const match = typeof mime === "string" ? /rate=(\d+)/.exec(mime) : null;
  return match?.[1] === undefined ? PCM_RATE : Number(match[1]);
}

export function createGeminiProvider(options: GeminiOptions): TtsProvider {
  const { apiKey } = options;
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const api = GEMINI_MODELS[model] ?? "generateContent";
  const doFetch = options.fetch ?? fetch;

  async function post(url: string, body: unknown): Promise<Json> {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json: Json & { error?: { message?: string } } = {};
    let parseError: unknown;
    try {
      json = (await response.json()) as typeof json;
    } catch (error) {
      parseError = error;
    }
    if (!response.ok) {
      throw new Error(
        `Gemini ${model}: ${json.error?.message ?? `HTTP ${response.status}`}`,
        { cause: parseError },
      );
    }
    if (parseError !== undefined) {
      throw new Error(`Gemini ${model}: reply is not valid JSON`, {
        cause: parseError,
      });
    }
    return json;
  }

  return {
    id: "gemini-tts",
    model,
    voices: GEMINI_VOICES,
    async synthesize({ text, voiceId, style }) {
      let data: string | undefined;
      let rate = PCM_RATE;
      const styleText = style?.trim() ?? "";
      if (api === "interactions") {
        const j = (await post(`${BASE}/interactions`, {
          model,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text,
                  annotations:
                    styleText === ""
                      ? []
                      : [{ type: "speech_metadata", style: styleText }],
                },
              ],
            },
          ],
          response_format: {
            type: "audio",
            mime_type: "audio/l16",
            sample_rate: PCM_RATE,
          },
          generation_config: { speech_config: [{ voice: voiceId }] },
        })) as {
          steps?: { content?: { type: string; data?: string }[] }[];
        };
        data = (j.steps ?? [])
          .flatMap((s) => s.content ?? [])
          .filter((c) => c.type === "audio")
          .pop()?.data;
      } else {
        const prompt =
          styleText === "" ? text : `${styleText}. Say the following:\n${text}`;
        const j = (await post(`${BASE}/models/${model}:generateContent`, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } },
            },
          },
        })) as {
          candidates?: {
            content?: {
              parts?: { inlineData?: { data?: string; mimeType?: string } }[];
            };
          }[];
        };
        const inline = j.candidates?.[0]?.content?.parts?.find(
          (p) => p.inlineData,
        )?.inlineData;
        data = inline?.data;
        rate = rateFromMime(inline?.mimeType);
      }
      if (data === undefined || data === "") {
        throw new Error(`Gemini ${model}: no audio in response`);
      }
      const bytes = Buffer.from(data, "base64");
      const isWav = bytes.subarray(0, 4).toString("ascii") === "RIFF";
      return {
        audio: isWav ? bytes : pcmToWav(bytes, rate, 1),
        format: "wav" as const,
        sampleRate: rate,
        channels: 1,
      };
    },
  };
}

/** Reads `GEMINI_API_KEY`; a missing key is AS-VOICE-1. */
export function geminiFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: typeof fetch,
): TtsProvider {
  const apiKey = env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new CliError(
      "AS-VOICE-1",
      "GEMINI_API_KEY is not set; the Gemini voice needs it in the environment.",
    );
  }
  const model = env.ASSET_STUDIO_TTS_MODEL ?? DEFAULT_GEMINI_MODEL;
  const options: GeminiOptions = { apiKey, model };
  if (fetchImpl !== undefined) options.fetch = fetchImpl;
  return createGeminiProvider(options);
}
