import { z } from "zod";

/** Camera-track contract v1 (docs/camera-track-contract.md), shape rules only. */

export const CAMERA_MOVES = [
  "push-in",
  "pull-out",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "drift",
] as const;
export const CAMERA_SPEEDS = ["slow", "medium", "fast"] as const;
export const CAMERA_EASES = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
] as const;

const EPSILON = 1e-9;

// Same pattern as docs/camera-track.schema.json.
const STILL_PATTERN = /^(?!\/)(?!.*(^|\/)\.\.(\/|$)).+\.(webp|jpg|jpeg)$/;

const unit = z.number().min(0).max(1);
const positiveUnit = z.number().gt(0).max(1);

export const cameraFrameSchema = z
  .strictObject({ x: unit, y: unit, w: positiveUnit, h: positiveUnit })
  .superRefine((frame, ctx) => {
    if (
      frame.x - frame.w / 2 < -EPSILON ||
      frame.x + frame.w / 2 > 1 + EPSILON
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "frame crop leaves the still horizontally (x ± w/2 outside 0..1)",
        path: ["x"],
      });
    }
    if (
      frame.y - frame.h / 2 < -EPSILON ||
      frame.y + frame.h / 2 > 1 + EPSILON
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "frame crop leaves the still vertically (y ± h/2 outside 0..1)",
        path: ["y"],
      });
    }
  });

type Frame = z.infer<typeof cameraFrameSchema>;

const framesEqual = (a: Frame, b: Frame): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export const cameraCueSchema = z
  .strictObject({
    start: z.number().min(0),
    end: z.number().min(0),
    from: cameraFrameSchema,
    to: cameraFrameSchema,
    ease: z.enum(CAMERA_EASES).optional(),
  })
  .superRefine((cue, ctx) => {
    if (cue.end < cue.start) {
      ctx.addIssue({
        code: "custom",
        message: "cue end is before its start",
        path: ["end"],
      });
    }
    if (cue.ease !== undefined && framesEqual(cue.from, cue.to)) {
      ctx.addIssue({
        code: "custom",
        message: "a hold (from equal to to) omits ease",
        path: ["ease"],
      });
    }
  });

export const cameraTrackSchema = z
  .strictObject({
    still: z
      .string()
      .regex(
        STILL_PATTERN,
        "still must be a relative .webp, .jpg or .jpeg path with no leading / and no .. segment",
      ),
    standeeOff: z.boolean().optional(),
    opening: z.literal("letterbox-hold-push").optional(),
    cues: z.array(cameraCueSchema),
  })
  .superRefine((track, ctx) => {
    track.cues.forEach((cue, index) => {
      const previous = track.cues[index - 1];
      if (previous !== undefined && cue.start < previous.end) {
        ctx.addIssue({
          code: "custom",
          message: `cue ${index} starts at ${cue.start} before cue ${index - 1} ends at ${previous.end}`,
          path: ["cues", index, "start"],
        });
      }
    });
  });

export const cameraFocusSchema = z.strictObject({
  x: unit,
  y: unit,
  w: unit,
  h: unit,
});

/**
 * A moment's camera: a named move (`move`, `speed`, `focus`, all optional,
 * `drift` when no move is named) or a drawn `track`, never both.
 */
export const cameraSchema = z
  .strictObject({
    move: z.enum(CAMERA_MOVES).optional(),
    speed: z.enum(CAMERA_SPEEDS).optional(),
    focus: cameraFocusSchema.optional(),
    track: cameraTrackSchema.optional(),
  })
  .superRefine((camera, ctx) => {
    if (
      camera.track !== undefined &&
      (camera.move !== undefined ||
        camera.speed !== undefined ||
        camera.focus !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "a camera is a named move or a drawn track, not both",
        path: ["track"],
      });
    }
  });

export type CameraFrame = Frame;
export type CameraCue = z.infer<typeof cameraCueSchema>;
export type CameraTrack = z.infer<typeof cameraTrackSchema>;
export type Camera = z.infer<typeof cameraSchema>;
