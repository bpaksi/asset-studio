import { z } from "zod";

import { RHUBARB_LETTERS, type RhubarbLetter } from "./rhubarb.js";

// Asset contract v2 (docs/asset-contract.md): one character folder,
// avatars/<id>/, described by manifest.json. These schemas are browser-safe;
// the file checks live in validateAvatar (@asset-studio/formats/node).

export const MOUTH_MODES = ["frame", "overlay"] as const;
export type MouthMode = (typeof MOUTH_MODES)[number];
export const DEFAULT_MOUTH_MODE: MouthMode = "frame";

/** Rule numbers of the contract's validation list, plus "schema" for a file that is unreadable or misshapen outside those rules. */
export type AvatarRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | "schema";

/** True when `path` is relative to the avatar folder and stays inside it (rule 10). */
export function isAvatarRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  // A scheme (`http:`, `data:`) or a drive letter (`C:`) is not relative.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return !path.split("/").includes("..");
}

const avatarPathSchema = z
  .string()
  .min(1)
  .refine(isAvatarRelativePath, {
    message: "path must be relative to the avatar folder",
    params: { rule: 10 },
  });

export const mouthModeSchema = z.enum(MOUTH_MODES);

export const anchorSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const avatarMouthsSchema = z.object(
  Object.fromEntries(
    RHUBARB_LETTERS.map((letter) => [letter, avatarPathSchema]),
  ) as Record<RhubarbLetter, typeof avatarPathSchema>,
);

export const avatarLineSchema = z.object({
  line_id: z.string().min(1),
  audio: avatarPathSchema,
  timing: avatarPathSchema,
  text: z.string().min(1),
});

export const avatarManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  portrait: avatarPathSchema,
  anchor: avatarPathSchema,
  mouths: avatarMouthsSchema,
  mouthMode: mouthModeSchema.optional(),
  captionTheme: z.string().min(1).optional(),
  lines: z.array(avatarLineSchema).superRefine((lines, ctx) => {
    const seen = new Set<string>();
    lines.forEach((line, index) => {
      if (seen.has(line.line_id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate line_id "${line.line_id}"`,
          path: [index, "line_id"],
          params: { rule: 3 },
        });
      }
      seen.add(line.line_id);
    });
  }),
});

export type Anchor = z.infer<typeof anchorSchema>;
export type AvatarLine = z.infer<typeof avatarLineSchema>;
export type AvatarManifest = z.infer<typeof avatarManifestSchema>;

export function isMouthMode(value: unknown): value is MouthMode {
  return (MOUTH_MODES as readonly unknown[]).includes(value);
}

export function effectiveMouthMode(manifest: {
  mouthMode?: MouthMode;
}): MouthMode;
export function effectiveMouthMode(manifest: { mouthMode?: unknown }): unknown;
export function effectiveMouthMode(manifest: { mouthMode?: unknown }): unknown {
  if (manifest.mouthMode === undefined) {
    return DEFAULT_MOUTH_MODE;
  }
  return manifest.mouthMode;
}

/**
 * File name of a shape id (`CONS/EE` -> `CONS-EE.webp`); shape ids in JSON keep the `/`.
 * Contract v2 prefers WebP; pass `"png"` for PNG art.
 */
export function mouthFileName(
  shape: string,
  extension: "webp" | "png" = "webp",
): string {
  return `${shape.replaceAll("/", "-")}.${extension}`;
}
