// A deterministic image provider for CI. It makes no network call.
import { createHash } from "node:crypto";

import sharp from "sharp";

import type { ImageProvider, ImageRequest } from "./provider.js";

export type FakeImageOptions = {
  /** Asset IDs whose request throws. */
  failIds?: readonly string[];
  /** Asset IDs that get a deliberately wrong output. */
  wrong?: Record<string, "size" | "colour" | "garbage">;
  /** Throw this text (for example one that echoes a key) instead of a plain message. */
  failMessage?: string;
};

export type FakeImageProvider = ImageProvider & {
  /** Every request received, in order (deep copies). */
  calls: ImageRequest[];
};

const seedOf = (req: ImageRequest): Buffer =>
  createHash("sha256")
    .update(
      JSON.stringify([
        req.kind,
        req.id,
        req.prompt,
        req.style,
        req.notes,
        req.size,
      ]),
    )
    .digest();

export function createFakeImageProvider(
  options: FakeImageOptions = {},
): FakeImageProvider {
  const calls: ImageRequest[] = [];
  return {
    id: "fake-image",
    model: "fake-1",
    calls,
    async generate(req) {
      calls.push(structuredClone(req));
      if (options.failIds?.includes(req.id) === true) {
        throw new Error(
          options.failMessage ?? `fake provider failure for ${req.id}`,
        );
      }
      const wrong = options.wrong?.[req.id];
      if (wrong === "garbage") return { image: Buffer.from("not an image") };
      const width = req.size.width + (wrong === "size" ? 1 : 0);
      const height = req.size.height;
      const seed = seedOf(req);
      const raw = Buffer.alloc(width * height * 3);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const o = (y * width + x) * 3;
          if (req.kind === "mask") {
            const v = x < width / 2 ? 255 : 0;
            raw[o] = v;
            raw[o + 1] = wrong === "colour" && x === 0 && y === 0 ? 0 : v;
            raw[o + 2] = v;
          } else {
            raw[o] = ((seed[0] ?? 0) + x * 7) % 256;
            raw[o + 1] = ((seed[1] ?? 0) + y * 5) % 256;
            raw[o + 2] = seed[2] ?? 0;
          }
        }
      }
      const image = await sharp(raw, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer();
      return { image, mimeType: "image/png" };
    },
  };
}
