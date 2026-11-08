// Gemini image provider (generateContent with an image model). Tested only
// against a mocked fetch. The key comes from the environment and is sent as a
// header; it is never put in a message.
import { CliError } from "../config/errors.js";
import type { ImageProvider, ImageRequest } from "./provider.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

export type GeminiImageOptions = {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
};

/** The text part of the request: what to make, in which style, with which notes. */
export function buildPrompt(req: ImageRequest): string {
  const lines: string[] = [];
  const { width, height } = req.size;
  if (req.kind === "mask") {
    lines.push(
      `Make a glow mask for the attached painting. Greyscale only: white where the painting glows, black everywhere else, no colour. Exactly ${width}x${height} pixels, the same framing as the painting.`,
    );
  } else if (req.kind === "still") {
    lines.push(
      `Paint a portrait still, ${width}x${height} pixels${
        req.subject === undefined
          ? ""
          : ` of ${req.subject.name} showing the mood "${req.subject.mood}"`
      }.`,
    );
  } else {
    lines.push(`Paint a picture, ${width}x${height} pixels.`);
  }
  if (req.prompt !== undefined) lines.push(`Subject: ${req.prompt}`);
  if (req.style !== undefined) lines.push(`Style: ${req.style}`);
  if (req.references.length > 0) {
    lines.push(
      `Reference images are attached in this order: ${req.references.map((r) => r.name).join(", ")}.`,
    );
  }
  if (req.notes.length > 0) {
    lines.push(
      "Notes from the reviewer on the previous attempt (apply them):",
      ...req.notes.map((n) => `- ${n}`),
    );
  }
  return lines.join("\n");
}

const sniff = (bytes: Uint8Array): string =>
  bytes[0] === 0x89 && bytes[1] === 0x50
    ? "image/png"
    : bytes[0] === 0xff && bytes[1] === 0xd8
      ? "image/jpeg"
      : "image/webp";

export function createGeminiImageProvider(
  options: GeminiImageOptions,
): ImageProvider {
  const { apiKey } = options;
  const model = options.model ?? DEFAULT_IMAGE_MODEL;
  const doFetch = options.fetch ?? fetch;
  return {
    id: "gemini-image",
    model,
    async generate(req) {
      const parts: unknown[] = [{ text: buildPrompt(req) }];
      for (const ref of req.references) {
        parts.push({
          inlineData: {
            mimeType: sniff(ref.bytes),
            data: Buffer.from(ref.bytes).toString("base64"),
          },
        });
      }
      if (req.painting !== undefined) {
        parts.push({
          inlineData: {
            mimeType: sniff(req.painting),
            data: Buffer.from(req.painting).toString("base64"),
          },
        });
      }
      const response = await doFetch(
        `${BASE}/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }),
        },
      );
      let json: {
        error?: { message?: string };
        promptFeedback?: { blockReason?: string };
        candidates?: {
          content?: {
            parts?: { inlineData?: { data?: string; mimeType?: string } }[];
          };
        }[];
      } = {};
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
      const inline = json.candidates
        ?.flatMap((c) => c.content?.parts ?? [])
        .find((p) => p.inlineData?.data)?.inlineData;
      if (inline?.data === undefined || inline.data === "") {
        const why = json.promptFeedback?.blockReason;
        throw new Error(
          `Gemini ${model}: no image in response${why === undefined ? "" : ` (blocked: ${why})`}`,
        );
      }
      const out: { image: Uint8Array; mimeType?: string } = {
        image: Buffer.from(inline.data, "base64"),
      };
      if (inline.mimeType !== undefined) out.mimeType = inline.mimeType;
      return out;
    },
  };
}

/** Reads `GEMINI_API_KEY`; a missing key is AS-AI-1. */
export function geminiImageFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: typeof fetch,
): ImageProvider {
  const apiKey = env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new CliError(
      "AS-AI-1",
      "GEMINI_API_KEY is not set; AI mode needs it in the environment.",
    );
  }
  const options: GeminiImageOptions = {
    apiKey,
    model: env.ASSET_STUDIO_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL,
  };
  if (fetchImpl !== undefined) options.fetch = fetchImpl;
  return createGeminiImageProvider(options);
}
