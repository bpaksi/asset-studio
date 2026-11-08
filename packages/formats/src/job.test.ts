// biome-ignore-all lint/suspicious/noExplicitAny: fixtures are edited as loose JSON to build invalid jobs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { derivedIds, isAssetId, type Job, jobSchema } from "./job.js";

// Generated fixtures: every job below is built here from neutral placeholder
// data. No consumer story, art or script is used.

type Json = Record<string, unknown>;

function makeJob(): Json {
  return {
    schema: 1,
    story: "lantern-tale",
    source: `sha256:${"ab".repeat(32)}`,
    style: {
      picture: "ink wash, warm light, muted palette",
      references: ["ref/style.webp"],
    },
    profiles: {
      wide: { width: 1920, height: 1080 },
      tall: { width: 1640, height: 2360 },
      portrait: { width: 720, height: 900 },
    },
    cast: [
      {
        id: "keeper",
        name: "The Keeper",
        voice: { provider: "gemini-tts", voiceId: "Voice-A", style: "calm" },
        captionTheme: "parchment",
        moods: ["neutral", "friendly", "angry"],
        portraits: [
          { mood: "angry", source: "art/keeper-angry.png" },
          { mood: "neutral", prompt: "an old keeper with a lantern" },
        ],
        references: ["ref/keeper-sheet.webp"],
      },
      {
        id: "stranger",
        name: "Stranger",
        moods: ["neutral", "scared"],
      },
    ],
    lines: [
      {
        id: "scene-one.02~vo-01",
        speaker: "keeper",
        mood: "angry",
        text: "You come late. [pause 0.4] The others did not.",
      },
      { id: "scene-one.03~vo-01", speaker: "keeper", text: "Sit down." },
    ],
    pictures: [
      {
        id: "painting.scene-one",
        kind: "painting",
        profiles: ["wide"],
        prompt: "a stair at dawn",
        glow: true,
      },
      {
        id: "foe.wolf",
        kind: "foe",
        profiles: ["wide", "tall"],
        source: "art/wolf.png",
      },
    ],
    moments: [
      {
        id: "scene-one.01",
        picture: "painting.scene-one",
        camera: {
          move: "push-in",
          speed: "slow",
          focus: { x: 0.6, y: 0.4, w: 0.3, h: 0.3 },
        },
      },
      { id: "scene-one.02", picture: "foe.wolf" },
    ],
    sounds: [{ id: "sound.door", kind: "effect", source: "sfx/door.wav" }],
  };
}

function track(): Json {
  return {
    still: "stills/scene-one.webp",
    standeeOff: true,
    opening: "letterbox-hold-push",
    cues: [
      {
        start: 0,
        end: 6.4,
        from: { x: 0.5, y: 0.5, w: 1, h: 0.5625 },
        to: { x: 0.46, y: 0.42, w: 0.55, h: 0.31 },
        ease: "ease-in-out",
      },
    ],
  };
}

/** Clone the base job, let `edit` change it, and parse. */
function parseWith(edit: (job: any) => void) {
  const job = structuredClone(makeJob()) as any;
  edit(job);
  return jobSchema.safeParse(job);
}

type Seen = { path: string; message: string };
function issues(result: ReturnType<typeof parseWith>): Seen[] {
  return result.success
    ? []
    : result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
}

function expectFailure(
  edit: (job: any) => void,
  path: string,
  ...fragments: string[]
) {
  const found = issues(parseWith(edit));
  const hit = found.find(
    (i) =>
      i.path === path &&
      fragments.every((fragment) => i.message.includes(fragment)),
  );
  expect(hit, JSON.stringify(found)).toBeDefined();
}

describe("jobSchema: positive", () => {
  it("accepts the documented example job", () => {
    const result = parseWith(() => {});
    expect(issues(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("accepts the example in docs/job-contract.md and lists its ids as documented", () => {
    const doc = readFileSync(
      resolve(import.meta.dirname, "../../../docs/job-contract.md"),
      "utf8",
    );
    const block = /```json\n([\s\S]*?)\n```/.exec(doc)?.[1];
    expect(block).toBeDefined();
    const job = jobSchema.parse(JSON.parse(block ?? ""));
    expect(derivedIds(job).map((d) => d.id)).toEqual([
      "portrait.keeper",
      "portrait.keeper~friendly",
      "portrait.keeper~angry",
      "portrait.stranger",
      "portrait.stranger~scared",
      "scene-one.02~vo-01",
      "painting.scene-one",
      "glow.scene-one",
      "foe.wolf",
      "sound.door",
    ]);
  });

  it("accepts a minimal job", () => {
    const result = jobSchema.safeParse({
      schema: 1,
      story: "tiny",
      source: `sha256:${"0".repeat(64)}`,
      profiles: {},
      cast: [],
      lines: [],
      pictures: [],
      moments: [],
      sounds: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a moment with a drawn camera-track v1 track", () => {
    expect(
      issues(
        parseWith((job) => {
          job.moments[0].camera = { track: track() };
        }),
      ),
    ).toEqual([]);
  });

  it("accepts every named move and speed", () => {
    for (const move of [
      "push-in",
      "pull-out",
      "pan-left",
      "pan-right",
      "tilt-up",
      "tilt-down",
      "drift",
    ]) {
      for (const speed of ["slow", "medium", "fast"]) {
        expect(
          parseWith((job) => {
            job.moments[0].camera = { move, speed };
          }).success,
        ).toBe(true);
      }
    }
  });

  it("accepts a focus box on the 0 and 1 edges, and a moment with no camera", () => {
    expect(
      parseWith((job) => {
        job.moments[0].camera = { focus: { x: 0, y: 0, w: 1, h: 1 } };
      }).success,
    ).toBe(true);
    expect(
      parseWith((job) => {
        job.moments[0].camera = undefined;
      }).success,
    ).toBe(true);
  });

  it("takes kinds and moods as free labels", () => {
    expect(
      parseWith((job) => {
        job.pictures[0].kind = "any-label-at-all";
        job.sounds[0].kind = "ambient bed";
        job.cast[1].moods = ["neutral", "smug"];
      }).success,
    ).toBe(true);
  });

  it("lets a mood with neither source nor prompt through (made in AI mode)", () => {
    expect(
      parseWith((job) => {
        job.cast[0].portraits.push({ mood: "friendly" });
      }).success,
    ).toBe(true);
  });

  it("accepts ids with a variant and with extra entry segments", () => {
    for (const id of [
      "painting.n1-house",
      "scene-one.02~vo-01",
      "n2.08.private.hunter~no-agnes",
    ]) {
      expect(isAssetId(id), id).toBe(true);
    }
  });
});

describe("jobSchema: negative", () => {
  it("fails a duplicate id, naming the field and id", () => {
    expectFailure(
      (job) => {
        job.pictures[1].id = "painting.scene-one";
      },
      "pictures.1.id",
      "duplicate id",
      "painting.scene-one",
    );
  });

  it("fails a duplicate id across lists", () => {
    expectFailure(
      (job) => {
        job.sounds[0].id = "scene-one.03~vo-01";
      },
      "sounds.0.id",
      "scene-one.03~vo-01",
    );
  });

  it("fails an id that collides with one asset-studio builds", () => {
    expectFailure(
      (job) => {
        job.pictures[1].id = "portrait.keeper";
      },
      "cast.0.id",
      "duplicate id",
      "portrait.keeper",
    );
    expectFailure(
      (job) => {
        job.pictures[1].id = "glow.scene-one";
      },
      "pictures.0.glow",
      "duplicate id",
      "glow.scene-one",
    );
  });

  it("does not reserve portrait ids for a speaker with no requested moods", () => {
    const job = structuredClone(makeJob()) as any;
    job.cast[0].moods = [];
    delete job.cast[0].portraits;
    for (const line of job.lines) delete line.mood;
    // A fresh picture, so no moment points at the renamed id.
    job.pictures.push({ ...job.pictures[1], id: "portrait.keeper" });
    expect(jobSchema.safeParse(job).success).toBe(true);
    job.pictures[2].id = "portrait.keeper~angry";
    expect(jobSchema.safeParse(job).success).toBe(true);
  });

  it("fails a duplicate cast id", () => {
    expectFailure(
      (job) => {
        job.cast[1].id = "keeper";
      },
      "cast.1.id",
      "keeper",
    );
  });

  it.each([
    ["uppercase", "Painting.Scene-One"],
    ["underscore", "painting.scene_one"],
    ["no entry", "painting"],
    ["space", "painting.scene one"],
    ["empty variant", "painting.scene-one~"],
    ["two variants", "painting.scene-one~a~b"],
    ["double hyphen", "painting.scene--one"],
    ["leading hyphen", "painting.-scene"],
    ["empty entry", "painting."],
  ])(
    "fails a picture id that is not <kind>.<entry>~<variant> (%s)",
    (_, id) => {
      expectFailure(
        (job) => {
          job.pictures[0].id = id;
        },
        "pictures.0.id",
        id,
        "kebab-case",
      );
    },
  );

  it("fails a line, moment and sound id that is not in the grammar", () => {
    expectFailure(
      (job) => {
        job.lines[0].id = "Scene_One.02";
      },
      "lines.0.id",
      "Scene_One.02",
    );
    expectFailure(
      (job) => {
        job.moments[0].id = "scene one";
      },
      "moments.0.id",
      "scene one",
    );
    expectFailure(
      (job) => {
        job.sounds[0].id = "SOUND.door";
      },
      "sounds.0.id",
      "SOUND.door",
    );
  });

  it("fails a mood that is not kebab-case", () => {
    expectFailure(
      (job) => {
        job.cast[0].moods = ["Neutral"];
        job.cast[0].portraits = [];
        job.lines = [];
      },
      "cast.0.moods.0",
      "Neutral",
    );
  });

  it("fails a line whose speaker is not in the cast", () => {
    expectFailure(
      (job) => {
        job.lines[0].speaker = "ghost";
      },
      "lines.0.speaker",
      "scene-one.02~vo-01",
      "ghost",
      "not in the cast",
    );
  });

  it("fails a line whose speaker has no voice", () => {
    expectFailure(
      (job) => {
        job.lines[0].speaker = "stranger";
        job.lines[0].mood = "scared";
      },
      "lines.0.speaker",
      "scene-one.02~vo-01",
      "stranger",
      "no voice",
    );
  });

  it("fails a line that names a mood its speaker lacks", () => {
    expectFailure(
      (job) => {
        job.lines[0].mood = "scared";
      },
      "lines.0.mood",
      "scene-one.02~vo-01",
      "scared",
    );
  });

  it("fails a portrait that names a mood not in its speaker's moods", () => {
    expectFailure(
      (job) => {
        job.cast[0].portraits.push({ mood: "sly", source: "art/x.png" });
      },
      "cast.0.portraits.2.mood",
      "sly",
      "keeper",
    );
  });

  it("fails a picture with neither source nor prompt", () => {
    expectFailure(
      (job) => {
        delete job.pictures[0].prompt;
      },
      "pictures.0",
      "painting.scene-one",
      "neither source nor prompt",
    );
  });

  it("fails a picture that names an unknown profile", () => {
    expectFailure(
      (job) => {
        job.pictures[1].profiles = ["wide", "ultrawide"];
      },
      "pictures.1.profiles.1",
      "foe.wolf",
      "ultrawide",
    );
  });

  it.each([
    "constructor",
    "toString",
    "hasOwnProperty",
    "__proto__",
    "valueOf",
  ])("fails an inherited object property as a profile (%s)", (name) => {
    expectFailure(
      (job) => {
        job.pictures[1].profiles = ["wide", name];
      },
      "pictures.1.profiles.1",
      "foe.wolf",
      "unknown profile",
      name,
    );
  });

  it("fails an inherited profile name when only wide is declared", () => {
    expectFailure(
      (job) => {
        job.profiles = { wide: { width: 1920, height: 1080 } };
        job.pictures[0].profiles = ["constructor"];
      },
      "pictures.0.profiles.0",
      "painting.scene-one",
      "constructor",
    );
  });

  it("accepts an own profile named like an object property", () => {
    const result = parseWith((job) => {
      job.profiles = {
        wide: { width: 1, height: 1 },
        tall: { width: 1, height: 1 },
        constructor: { width: 1, height: 1 },
      };
      job.pictures[0].profiles = ["constructor"];
    });
    expect(issues(result)).toEqual([]);
  });

  it("fails a moment whose picture is not in pictures", () => {
    expectFailure(
      (job) => {
        job.moments[1].picture = "foe.dragon";
      },
      "moments.1.picture",
      "scene-one.02",
      "foe.dragon",
    );
  });

  it("fails a camera move that is not on the list (reveal is gone)", () => {
    expectFailure((job) => {
      job.moments[0].camera = { move: "reveal" };
    }, "moments.0.camera.move");
    expectFailure((job) => {
      job.moments[0].camera = { move: "zoom" };
    }, "moments.0.camera.move");
  });

  it("fails a camera speed that is not on the list", () => {
    expectFailure((job) => {
      job.moments[0].camera = { move: "push-in", speed: "ludicrous" };
    }, "moments.0.camera.speed");
  });

  it.each([
    ["x above 1", { x: 1.2, y: 0.4, w: 0.3, h: 0.3 }, "x"],
    ["x below 0", { x: -0.1, y: 0.4, w: 0.3, h: 0.3 }, "x"],
    ["y above 1", { x: 0.6, y: 1.01, w: 0.3, h: 0.3 }, "y"],
    ["w above 1", { x: 0.6, y: 0.4, w: 1.5, h: 0.3 }, "w"],
    ["h below 0", { x: 0.6, y: 0.4, w: 0.3, h: -0.3 }, "h"],
  ])("fails a focus box outside 0..1 (%s)", (_, focus, field) => {
    expectFailure((job) => {
      job.moments[0].camera = { move: "push-in", focus };
    }, `moments.0.camera.focus.${field}`);
  });

  const hold = { x: 0.5, y: 0.5, w: 1, h: 1 };
  it.each([
    ["move", { move: "zoom" }, "move"],
    ["speed", { move: "push-in", speed: "ludicrous" }, "speed"],
    [
      "focus",
      { move: "push-in", focus: { x: 1.2, y: 0, w: 1, h: 1 } },
      "focus.x",
    ],
    [
      "track",
      {
        track: {
          ...track(),
          cues: [{ start: 2, end: 1, from: hold, to: hold }],
        },
      },
      "track.cues.0.end",
    ],
    ["move with track", { move: "push-in", track: track() }, "track"],
  ])(
    "names the owning moment and the indexed path on a camera %s failure",
    (_, camera, tail) => {
      expectFailure(
        (job) => {
          job.moments[1].camera = camera;
        },
        `moments.1.camera.${tail}`,
        'moment "scene-one.02"',
      );
    },
  );

  it("fails a job with a status field", () => {
    expectFailure(
      (job) => {
        job.status = "final";
      },
      "status",
      "no status",
    );
  });

  it("fails a status field anywhere in the job", () => {
    const spots: [(job: any) => void, string][] = [
      [(job) => (job.cast[0].status = "draft"), "cast.0.status"],
      [(job) => (job.cast[0].voice.status = "draft"), "cast.0.voice.status"],
      [
        (job) => (job.cast[0].portraits[0].status = "draft"),
        "cast.0.portraits.0.status",
      ],
      [(job) => (job.lines[0].status = "final"), "lines.0.status"],
      [(job) => (job.pictures[0].status = "final"), "pictures.0.status"],
      [(job) => (job.moments[0].status = "final"), "moments.0.status"],
      [(job) => (job.sounds[0].status = "final"), "sounds.0.status"],
      [(job) => (job.profiles.wide.status = "final"), "profiles.wide.status"],
      [(job) => (job.style.status = "final"), "style.status"],
    ];
    for (const [edit, path] of spots) {
      expectFailure(edit, path, "no status");
    }
  });

  it("rejects unknown fields, a wrong schema version and a bad source hash", () => {
    expect(parseWith((job) => (job.extra = 1)).success).toBe(false);
    expect(parseWith((job) => (job.schema = 2)).success).toBe(false);
    expect(parseWith((job) => (job.source = "sha256:…")).success).toBe(false);
    expect(parseWith((job) => (job.lines[0].text = "")).success).toBe(false);
  });
});

describe("jobSchema: camera-track v1 on a moment's track", () => {
  const withTrack = (edit: (t: any) => void) => (job: any) => {
    const t = track() as any;
    edit(t);
    job.moments[0].camera = { track: t };
  };
  const base = "moments.0.camera.track";

  it("accepts every ease, a hold, an empty cue list, and the .jpg and .jpeg stills", () => {
    for (const ease of ["linear", "ease-in", "ease-out", "ease-in-out"]) {
      expect(parseWith(withTrack((t) => (t.cues[0].ease = ease))).success).toBe(
        true,
      );
    }
    expect(
      parseWith(
        withTrack((t) => {
          t.cues[0].to = t.cues[0].from;
          delete t.cues[0].ease;
        }),
      ).success,
    ).toBe(true);
    expect(parseWith(withTrack((t) => (t.cues = []))).success).toBe(true);
    expect(parseWith(withTrack((t) => (t.still = "a/b.jpg"))).success).toBe(
      true,
    );
    expect(parseWith(withTrack((t) => (t.still = "a/b.jpeg"))).success).toBe(
      true,
    );
  });

  it("accepts back-to-back cues (start equal to the previous end)", () => {
    expect(
      parseWith(
        withTrack((t) => {
          t.cues.push({
            start: 6.4,
            end: 9,
            from: t.cues[0].to,
            to: { x: 0.5, y: 0.5, w: 0.5, h: 0.3 },
          });
        }),
      ).success,
    ).toBe(true);
  });

  it("fails an absolute still, a .. still, and a PNG still", () => {
    expectFailure(
      withTrack((t) => (t.still = "/abs/x.webp")),
      `${base}.still`,
    );
    expectFailure(
      withTrack((t) => (t.still = "../x.webp")),
      `${base}.still`,
    );
    expectFailure(
      withTrack((t) => (t.still = "a/../x.webp")),
      `${base}.still`,
    );
    expectFailure(
      withTrack((t) => (t.still = "x.png")),
      `${base}.still`,
    );
  });

  it("fails a non-boolean standeeOff and an unknown opening", () => {
    expectFailure(
      withTrack((t) => (t.standeeOff = "yes")),
      `${base}.standeeOff`,
    );
    expectFailure(
      withTrack((t) => (t.opening = "fade")),
      `${base}.opening`,
    );
  });

  it("fails cues that are not an array", () => {
    expectFailure(
      withTrack((t) => (t.cues = {})),
      `${base}.cues`,
    );
  });

  it("fails frame values out of range and crops that leave the still", () => {
    expectFailure(
      withTrack((t) => (t.cues[0].from.x = 1.5)),
      `${base}.cues.0.from.x`,
    );
    expectFailure(
      withTrack((t) => (t.cues[0].from.w = 0)),
      `${base}.cues.0.from.w`,
    );
    expectFailure(
      withTrack((t) => (t.cues[0].to = { x: 0.9, y: 0.5, w: 0.5, h: 0.5 })),
      `${base}.cues.0.to.x`,
      "horizontally",
    );
    expectFailure(
      withTrack((t) => (t.cues[0].to = { x: 0.5, y: 0.05, w: 0.5, h: 0.5 })),
      `${base}.cues.0.to.y`,
      "vertically",
    );
  });

  it("fails a cue that ends before it starts, and overlapping cues", () => {
    expectFailure(
      withTrack((t) => {
        t.cues[0].start = 3;
        t.cues[0].end = 2;
      }),
      `${base}.cues.0.end`,
    );
    expectFailure(
      withTrack((t) => (t.cues[0].start = -1)),
      `${base}.cues.0.start`,
    );
    expectFailure(
      withTrack((t) => {
        t.cues.push({
          start: 5,
          end: 8,
          from: t.cues[0].to,
          to: { x: 0.5, y: 0.5, w: 0.5, h: 0.3 },
        });
      }),
      `${base}.cues.1.start`,
      "before cue 0 ends",
    );
  });

  it("fails an ease outside the set, and an ease on a hold", () => {
    expectFailure(
      withTrack((t) => (t.cues[0].ease = "bounce")),
      `${base}.cues.0.ease`,
    );
    expectFailure(
      withTrack((t) => {
        t.cues[0].to = t.cues[0].from;
      }),
      `${base}.cues.0.ease`,
      "hold",
    );
  });

  it("fails unknown keys on the track, a cue and a frame", () => {
    expect(parseWith(withTrack((t) => (t.id = "x"))).success).toBe(false);
    expect(parseWith(withTrack((t) => (t.cues[0].speed = 1))).success).toBe(
      false,
    );
    expect(parseWith(withTrack((t) => (t.cues[0].from.z = 1))).success).toBe(
      false,
    );
  });

  it("fails a track mixed with a named move", () => {
    expectFailure(
      (job) => {
        job.moments[0].camera = { move: "push-in", track: track() };
      },
      "moments.0.camera.track",
      "not both",
    );
  });

  it("accepts the camera-track examples shipped in docs/examples", () => {
    const examples = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../docs/examples/camera-track.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const entries = Object.entries(examples).filter(
      ([key]) => !key.startsWith("_"),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, example] of entries) {
      const found = issues(
        parseWith((job) => {
          job.moments[0].camera = { track: example };
        }),
      );
      expect(found, id).toEqual([]);
    }
  });
});

describe("derivedIds", () => {
  const ids = (edit: (job: any) => void = () => {}) => {
    const job = structuredClone(makeJob()) as any;
    edit(job);
    return derivedIds(jobSchema.parse(job) as Job);
  };

  it("returns every id the job implies, in a stable order", () => {
    expect(ids().map((d) => d.id)).toEqual([
      "portrait.keeper",
      "portrait.keeper~friendly",
      "portrait.keeper~angry",
      "portrait.stranger",
      "portrait.stranger~scared",
      "scene-one.02~vo-01",
      "scene-one.03~vo-01",
      "painting.scene-one",
      "glow.scene-one",
      "foe.wolf",
      "sound.door",
    ]);
  });

  it("builds neutral as portrait.<speaker>, never portrait.<speaker>~neutral", () => {
    const all = ids().map((d) => d.id);
    expect(all).not.toContain("portrait.keeper~neutral");
    expect(all).toContain("portrait.keeper");
  });

  it("covers a voiced speaker: a portrait per mood and the voiced lines", () => {
    const list = ids();
    const keeper = list.filter((d) => d.id.startsWith("portrait.keeper"));
    expect(keeper.map((d) => d.id)).toEqual([
      "portrait.keeper",
      "portrait.keeper~friendly",
      "portrait.keeper~angry",
    ]);
    expect(
      keeper.every((d) => d.kind === "portrait" && d.origin === "built"),
    ).toBe(true);
    expect(list.filter((d) => d.kind === "line").map((d) => d.id)).toEqual([
      "scene-one.02~vo-01",
      "scene-one.03~vo-01",
    ]);
  });

  it("covers a voiceless cast member: stills only, no lines", () => {
    const list = ids();
    const stranger = list.filter((d) => d.id.includes("stranger"));
    expect(stranger.map((d) => d.id)).toEqual([
      "portrait.stranger",
      "portrait.stranger~scared",
    ]);
    expect(
      list.some((d) => d.kind === "line" && d.id.includes("stranger")),
    ).toBe(false);
  });

  it("derives zero portraits for a speaker with no requested moods, but keeps its lines", () => {
    const list = ids((job) => {
      job.cast[0].moods = [];
      delete job.cast[0].portraits;
      for (const line of job.lines) delete line.mood;
    });
    expect(list.some((d) => d.id.startsWith("portrait.keeper"))).toBe(false);
    expect(list.filter((d) => d.kind === "line").map((d) => d.id)).toEqual([
      "scene-one.02~vo-01",
      "scene-one.03~vo-01",
    ]);
    expect(list.filter((d) => d.kind === "portrait").map((d) => d.id)).toEqual([
      "portrait.stranger",
      "portrait.stranger~scared",
    ]);
  });

  it("covers a glow picture: glow.<entry> follows its painting, built by asset-studio", () => {
    const list = ids();
    const at = list.findIndex((d) => d.id === "painting.scene-one");
    expect(list[at]).toEqual({
      id: "painting.scene-one",
      kind: "painting",
      origin: "job",
    });
    expect(list[at + 1]).toEqual({
      id: "glow.scene-one",
      kind: "glow",
      origin: "built",
    });
    expect(list.filter((d) => d.id.startsWith("glow."))).toHaveLength(1);
  });

  it("adds no glow when glow is false or absent, and carries picture and sound kinds", () => {
    const list = ids((job) => {
      job.pictures[0].glow = false;
    });
    expect(list.some((d) => d.kind === "glow")).toBe(false);
    expect(list.find((d) => d.id === "foe.wolf")?.kind).toBe("foe");
    expect(list.find((d) => d.id === "sound.door")?.kind).toBe("effect");
  });

  it("does not list moments, which have no file or status", () => {
    expect(ids().some((d) => d.id === "scene-one.01")).toBe(false);
  });

  it("is empty for an empty job", () => {
    expect(
      derivedIds(
        jobSchema.parse({
          schema: 1,
          story: "tiny",
          source: `sha256:${"0".repeat(64)}`,
          profiles: {},
          cast: [],
          lines: [],
          pictures: [],
          moments: [],
          sounds: [],
        }),
      ),
    ).toEqual([]);
  });
});
