import { z } from "zod";

import { cameraSchema } from "./camera.js";

/** One kebab-case segment: lowercase letters and digits, hyphen separated. */
const SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
/** `<kind>.<entry>` with an optional `~<variant>`; also `<scene>.<moment>~<variant>`. */
export const ID_PATTERN = new RegExp(
  `^${SEGMENT}(?:\\.${SEGMENT})+(?:~${SEGMENT})?$`,
);
const SEGMENT_PATTERN = new RegExp(`^${SEGMENT}$`);

export const isAssetId = (value: string): boolean => ID_PATTERN.test(value);

export const assetIdSchema = z.string().regex(ID_PATTERN, {
  error: (issue) =>
    `id "${String(issue.input)}" must be <kind>.<entry>[~<variant>] in lowercase kebab-case`,
});

const segmentSchema = (what: string) =>
  z.string().regex(SEGMENT_PATTERN, {
    error: (issue) =>
      `${what} "${String(issue.input)}" must be lowercase kebab-case`,
  });

/** The job has no status anywhere (DEC-839): the index owns it. */
const noStatus = {
  status: z
    .never({
      error:
        "the job has no status field; status lives in the work folder index",
    })
    .optional(),
};

const text = z.string().min(1);

export const jobVoiceSchema = z.strictObject({
  ...noStatus,
  provider: text,
  voiceId: text,
  style: z.string().optional(),
});

export const jobPortraitSchema = z.strictObject({
  ...noStatus,
  mood: segmentSchema("mood"),
  source: text.optional(),
  prompt: text.optional(),
});

export const jobCastMemberSchema = z.strictObject({
  ...noStatus,
  id: segmentSchema("cast id"),
  name: text,
  voice: jobVoiceSchema.optional(),
  captionTheme: text.optional(),
  moods: z.array(segmentSchema("mood")),
  portraits: z.array(jobPortraitSchema).optional(),
  references: z.array(text).optional(),
});

export const jobLineSchema = z.strictObject({
  ...noStatus,
  id: assetIdSchema,
  speaker: text,
  mood: text.optional(),
  text,
});

export const jobPictureSchema = z.strictObject({
  ...noStatus,
  id: assetIdSchema,
  kind: text,
  profiles: z.array(text).min(1),
  source: text.optional(),
  prompt: text.optional(),
  glow: z.boolean().optional(),
});

export const jobMomentSchema = z.strictObject({
  ...noStatus,
  id: assetIdSchema,
  picture: text,
  camera: cameraSchema.optional(),
});

export const jobSoundSchema = z.strictObject({
  ...noStatus,
  id: assetIdSchema,
  kind: text,
  source: text,
});

export const jobProfileSchema = z.strictObject({
  ...noStatus,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const jobStyleSchema = z.strictObject({
  ...noStatus,
  picture: text,
  references: z.array(text).optional(),
});

/** `painting.n1-house` -> `glow.n1-house`. Only `<kind>.<entry>` ids have one. */
function glowId(pictureId: string): string | undefined {
  const dot = pictureId.indexOf(".");
  return dot === -1 ? undefined : `glow.${pictureId.slice(dot + 1)}`;
}

export const jobSchema = z
  .strictObject({
    ...noStatus,
    schema: z.literal(1),
    story: segmentSchema("story"),
    source: z.string().regex(/^sha256:[0-9a-f]{64}$/, {
      error: "source must be sha256:<64 lowercase hex digits>",
    }),
    style: jobStyleSchema.optional(),
    profiles: z.record(segmentSchema("profile name"), jobProfileSchema),
    cast: z.array(jobCastMemberSchema),
    lines: z.array(jobLineSchema),
    pictures: z.array(jobPictureSchema),
    moments: z.array(jobMomentSchema),
    sounds: z.array(jobSoundSchema),
  })
  .superRefine((job, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", message, path });

    // Duplicate ids, across every list and the ids asset-studio builds.
    const seen = new Map<string, string>();
    const claim = (id: string, path: (string | number)[]) => {
      const first = seen.get(id);
      if (first !== undefined) {
        issue(path, `duplicate id "${id}" (first used at ${first})`);
      } else {
        seen.set(id, path.join("."));
      }
    };
    const castIds = new Set<string>();
    job.cast.forEach((member, index) => {
      if (castIds.has(member.id)) {
        issue(["cast", index, "id"], `duplicate cast id "${member.id}"`);
      }
      castIds.add(member.id);
    });
    for (const list of ["lines", "pictures", "moments", "sounds"] as const) {
      job[list].forEach((item, i) => {
        claim(item.id, [list, i, "id"]);
      });
    }
    job.cast.forEach((member, index) => {
      claim(`portrait.${member.id}`, ["cast", index, "id"]);
      for (const mood of new Set(member.moods)) {
        if (mood !== "neutral") {
          claim(`portrait.${member.id}~${mood}`, ["cast", index, "moods"]);
        }
      }
    });
    job.pictures.forEach((picture, i) => {
      const glow = glowId(picture.id);
      if (picture.glow === true && glow !== undefined) {
        claim(glow, ["pictures", i, "glow"]);
      }
    });

    // Cast: a portrait's mood must be one of the member's moods.
    job.cast.forEach((member, index) => {
      member.portraits?.forEach((portrait, p) => {
        if (!member.moods.includes(portrait.mood)) {
          issue(
            ["cast", index, "portraits", p, "mood"],
            `portrait mood "${portrait.mood}" is not in the moods of cast member "${member.id}"`,
          );
        }
      });
    });

    // Lines.
    const byId = new Map(job.cast.map((member) => [member.id, member]));
    job.lines.forEach((line, index) => {
      const speaker = byId.get(line.speaker);
      if (speaker === undefined) {
        issue(
          ["lines", index, "speaker"],
          `line "${line.id}": speaker "${line.speaker}" is not in the cast`,
        );
        return;
      }
      if (speaker.voice === undefined) {
        issue(
          ["lines", index, "speaker"],
          `line "${line.id}": speaker "${line.speaker}" has no voice`,
        );
      }
      if (line.mood !== undefined && !speaker.moods.includes(line.mood)) {
        issue(
          ["lines", index, "mood"],
          `line "${line.id}": mood "${line.mood}" is not in the moods of speaker "${line.speaker}"`,
        );
      }
    });

    // Pictures.
    job.pictures.forEach((picture, index) => {
      if (picture.source === undefined && picture.prompt === undefined) {
        issue(
          ["pictures", index],
          `picture "${picture.id}" has neither source nor prompt`,
        );
      }
      picture.profiles.forEach((name, p) => {
        if (job.profiles[name] === undefined) {
          issue(
            ["pictures", index, "profiles", p],
            `picture "${picture.id}": unknown profile "${name}"`,
          );
        }
      });
    });

    // Moments.
    const pictureIds = new Set(job.pictures.map((picture) => picture.id));
    job.moments.forEach((moment, index) => {
      if (!pictureIds.has(moment.picture)) {
        issue(
          ["moments", index, "picture"],
          `moment "${moment.id}": picture "${moment.picture}" is not in pictures`,
        );
      }
    });
  });

export type Job = z.infer<typeof jobSchema>;
export type JobCastMember = z.infer<typeof jobCastMemberSchema>;
export type JobLine = z.infer<typeof jobLineSchema>;
export type JobPicture = z.infer<typeof jobPictureSchema>;
export type JobMoment = z.infer<typeof jobMomentSchema>;
export type JobSound = z.infer<typeof jobSoundSchema>;

export type DerivedId = {
  id: string;
  /** `line`, `portrait`, `glow`, or the job's own `kind` for a picture or sound. */
  kind: string;
  /** `job`: written in the job. `built`: asset-studio builds it (DEC-844). */
  origin: "job" | "built";
};

/**
 * Every asset ID the job implies, in a stable order: per cast member the
 * neutral still `portrait.<speaker>` then `portrait.<speaker>~<mood>` for each
 * other mood; then lines; then each picture followed by its `glow.<entry>`;
 * then sounds. Moments are not assets (no file, no status) and are not listed.
 * Input must have passed `jobSchema`.
 */
export function derivedIds(job: Job): DerivedId[] {
  const out: DerivedId[] = [];
  for (const member of job.cast) {
    out.push({
      id: `portrait.${member.id}`,
      kind: "portrait",
      origin: "built",
    });
    for (const mood of new Set(member.moods)) {
      if (mood !== "neutral") {
        out.push({
          id: `portrait.${member.id}~${mood}`,
          kind: "portrait",
          origin: "built",
        });
      }
    }
  }
  for (const line of job.lines) {
    out.push({ id: line.id, kind: "line", origin: "job" });
  }
  for (const picture of job.pictures) {
    out.push({ id: picture.id, kind: picture.kind, origin: "job" });
    const glow = glowId(picture.id);
    if (picture.glow === true && glow !== undefined) {
      out.push({ id: glow, kind: "glow", origin: "built" });
    }
  }
  for (const sound of job.sounds) {
    out.push({ id: sound.id, kind: sound.kind, origin: "job" });
  }
  return out;
}
