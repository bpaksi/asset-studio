import sharp from "sharp";

export type Dimensions = { width: number; height: number };

/** Lossless WebP: deterministic bytes for equal pixels, exact pixels on decode. */
const WEBP = { lossless: true, effort: 4 } as const;

/** Read the pixel size of an image; throws if the bytes are not a decodable image. */
export async function imageSize(bytes: Uint8Array): Promise<Dimensions> {
  const { data, info } = await sharp(bytes, { failOn: "error" })
    .raw()
    .toBuffer({
      resolveWithObject: true,
    });
  // A full decode (not just the header) so truncated or corrupt data fails here.
  void data;
  return { width: info.width, height: info.height };
}

/** Cover-crop to the exact profile size and encode as lossless WebP. */
export async function coverWebp(
  bytes: Uint8Array,
  target: Dimensions,
  options: { removeAlpha?: boolean } = {},
): Promise<Buffer> {
  let image = sharp(bytes, { failOn: "error" }).resize(
    target.width,
    target.height,
    { fit: "cover", position: "centre" },
  );
  if (options.removeAlpha === true) image = image.removeAlpha();
  return image.webp(WEBP).toBuffer();
}

/** Decoded pixels as 3-channel sRGB (alpha removed). */
export async function decodeRgb(
  bytes: Uint8Array,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(bytes, { failOn: "error" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
