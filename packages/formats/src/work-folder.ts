import { z } from "zod";

import { cameraSchema } from "./camera.js";
import { assetIdSchema } from "./job.js";

export const ASSET_STATUSES = [
  "missing",
  "draft",
  "final",
  "rejected",
] as const;
export const assetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

const notes = z.array(z.string().min(1));

/** Pixel size of a picture or still, or the length of audio in seconds. */
export const assetSizeSchema = z.union([
  z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.strictObject({ seconds: z.number().nonnegative() }),
]);

export const indexEntrySchema = z
  .strictObject({
    kind: z.string().min(1),
    /** File name in `store/` (`<hash>.<ext>`); null while missing. */
    file: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
        error: "file must be a bare file name in store/",
      })
      .nullable(),
    size: assetSizeSchema.nullable(),
    /** Hash of the inputs that made the file; null while missing. */
    inputsHash: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/, {
        error: "inputsHash must be sha256:<64 lowercase hex digits>",
      })
      .nullable(),
    status: assetStatusSchema,
    notes,
  })
  .superRefine((entry, ctx) => {
    const expectEmpty = entry.status === "missing";
    const fields = {
      file: entry.file,
      size: entry.size,
      inputsHash: entry.inputsHash,
    };
    for (const [field, value] of Object.entries(fields)) {
      if ((value === null) !== expectEmpty) {
        ctx.addIssue({
          code: "custom",
          message: expectEmpty
            ? `${field} must be null while the asset is missing`
            : `${field} is required once the asset is ${entry.status}`,
          path: [field],
        });
      }
    }
  });

/** `index.json`: one entry per asset ID. */
export const indexSchema = z.record(assetIdSchema, indexEntrySchema);

/** `notes.json`: "redo <ID>: <note>" entries, per asset ID. */
export const notesSchema = z.record(assetIdSchema, notes.min(1));

/** `camera.json`: the camera set in the studio, keyed by moment ID. */
export const cameraEditsSchema = z.record(assetIdSchema, cameraSchema);

export type IndexEntry = z.infer<typeof indexEntrySchema>;
export type AssetIndex = z.infer<typeof indexSchema>;
export type Notes = z.infer<typeof notesSchema>;
export type CameraEdits = z.infer<typeof cameraEditsSchema>;
