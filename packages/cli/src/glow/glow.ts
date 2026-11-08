import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CliError } from "../config/errors.js";
import { coverWebp, type Dimensions, decodeRgb } from "../picture/images.js";

/** `glow.n1-house` -> hand master `<masters>/glow.n1-house.png`. */
export const glowMasterPath = (masters: string, glowId: string): string =>
  join(masters, `${glowId}.png`);

export type CheckedMask = { bytes: Buffer; size: Dimensions };

/**
 * Read and check the hand-placed mask master: it must exist, decode, be
 * greyscale (R=G=B everywhere) and match the painting's pixel size exactly.
 * Codes: AS-GLOW-1 wrong size (asset ID and both sizes), AS-GLOW-2 missing
 * master, AS-GLOW-3 unreadable, AS-GLOW-4 coloured.
 */
export async function readMask(
  glowId: string,
  path: string,
  painting: Dimensions & { id: string },
): Promise<CheckedMask> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(
        "AS-GLOW-2",
        `${glowId}: the hand-placed mask master is missing (${path}).`,
      );
    }
    throw new CliError(
      "AS-GLOW-3",
      `${glowId}: cannot read mask master ${path}: ${(error as Error).message}`,
    );
  }
  let pixels: Awaited<ReturnType<typeof decodeRgb>>;
  try {
    pixels = await decodeRgb(bytes);
  } catch (error) {
    throw new CliError(
      "AS-GLOW-3",
      `${glowId}: mask master ${path} is not a readable image: ${(error as Error).message}`,
    );
  }
  const size = { width: pixels.width, height: pixels.height };
  if (size.width !== painting.width || size.height !== painting.height) {
    throw new CliError(
      "AS-GLOW-1",
      `${glowId}: mask is ${size.width}x${size.height} but ${painting.id} is ${painting.width}x${painting.height}.`,
    );
  }
  const { data } = pixels;
  for (let i = 0; i + 2 < data.length; i += 3) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) {
      const pixel = i / 3;
      throw new CliError(
        "AS-GLOW-4",
        `${glowId}: mask is not greyscale (pixel ${pixel % size.width},${Math.floor(pixel / size.width)} is not R=G=B).`,
      );
    }
  }
  return { bytes, size };
}

/**
 * The mask at a profile's size, with the same cover crop the painting got, so
 * the lit region stays aligned. Greyscale WebP (R=G=B), no alpha.
 */
export const maskWebp = (mask: Buffer, target: Dimensions): Promise<Buffer> =>
  coverWebp(mask, target, { removeAlpha: true });
