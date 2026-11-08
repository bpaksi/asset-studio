// biome-ignore-all lint/suspicious/noExplicitAny: fixtures are edited as loose JSON to build invalid data
import { describe, expect, it } from "vitest";

import { cameraEditsSchema, indexSchema, notesSchema } from "./work-folder.js";

// Generated fixtures: built here from placeholder data.

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

const makeIndex = () => ({
  "portrait.keeper": {
    kind: "portrait",
    file: "aaaa.webp",
    size: { width: 720, height: 900 },
    inputsHash: hash("a"),
    status: "final",
    notes: [],
  },
  "scene-one.02~vo-01": {
    kind: "line",
    file: "bbbb.m4a",
    size: { seconds: 3.25 },
    inputsHash: hash("b"),
    status: "draft",
    notes: ["slower"],
  },
  "foe.wolf": {
    kind: "foe",
    file: "cccc.webp",
    size: { width: 1920, height: 1080 },
    inputsHash: hash("c"),
    status: "rejected",
    notes: ["too cute"],
  },
  "glow.scene-one": {
    kind: "glow",
    file: null,
    size: null,
    inputsHash: null,
    status: "missing",
    notes: [],
  },
});

describe("indexSchema", () => {
  it("accepts one entry per id in each status", () => {
    expect(indexSchema.safeParse(makeIndex()).success).toBe(true);
    expect(indexSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const index: any = makeIndex();
    index["foe.wolf"].status = "approved";
    expect(indexSchema.safeParse(index).success).toBe(false);
  });

  it("rejects a key that is not an id", () => {
    const index: any = makeIndex();
    index.Wolf = index["foe.wolf"];
    expect(indexSchema.safeParse(index).success).toBe(false);
  });

  it("rejects a missing asset with a file, and a non-missing one without", () => {
    const withFile: any = makeIndex();
    withFile["glow.scene-one"].file = "dddd.webp";
    expect(indexSchema.safeParse(withFile).success).toBe(false);

    const without: any = makeIndex();
    without["foe.wolf"].file = null;
    const result = indexSchema.safeParse(without);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join(".")).toBe("foe.wolf.file");
  });

  it("rejects a file path (store files are bare names), a bad hash, a bad size and unknown fields", () => {
    for (const edit of [
      (e: any) => (e.file = "../x.webp"),
      (e: any) => (e.file = "store/x.webp"),
      (e: any) => (e.inputsHash = "abc"),
      (e: any) => (e.size = { width: 0, height: 10 }),
      (e: any) => (e.size = { seconds: -1 }),
      (e: any) => (e.notes = "slower"),
      (e: any) => (e.notes = [""]),
      (e: any) => (e.extra = true),
      (e: any) => (e.kind = ""),
    ]) {
      const index: any = makeIndex();
      edit(index["foe.wolf"]);
      expect(indexSchema.safeParse(index).success).toBe(false);
    }
  });
});

describe("notesSchema", () => {
  it("accepts redo notes per id", () => {
    expect(
      notesSchema.safeParse({
        "foe.wolf": ["too cute", "darker eyes"],
        "scene-one.02~vo-01": ["slower"],
      }).success,
    ).toBe(true);
    expect(notesSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an empty note, an empty list, a string value and a bad id", () => {
    expect(notesSchema.safeParse({ "foe.wolf": [""] }).success).toBe(false);
    expect(notesSchema.safeParse({ "foe.wolf": [] }).success).toBe(false);
    expect(notesSchema.safeParse({ "foe.wolf": "redo" }).success).toBe(false);
    expect(notesSchema.safeParse({ Wolf: ["x"] }).success).toBe(false);
  });
});

describe("cameraEditsSchema", () => {
  const track = {
    still: "stills/a.webp",
    cues: [
      {
        start: 0,
        end: 4,
        from: { x: 0.5, y: 0.5, w: 1, h: 0.5 },
        to: { x: 0.5, y: 0.5, w: 0.5, h: 0.3 },
      },
    ],
  };

  it("accepts named moves and drawn tracks keyed by moment id", () => {
    expect(
      cameraEditsSchema.safeParse({
        "scene-one.01": {
          move: "pan-left",
          speed: "medium",
          focus: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
        },
        "scene-one.02~alt": { track },
        "scene-one.03": {},
      }).success,
    ).toBe(true);
    expect(cameraEditsSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a bad move, speed, focus and track, and a bad moment id", () => {
    for (const camera of [
      { move: "reveal" },
      { speed: "warp" },
      { focus: { x: 2, y: 0, w: 0, h: 0 } },
      { track: { ...track, still: "x.png" } },
      { move: "drift", track },
    ]) {
      expect(
        cameraEditsSchema.safeParse({ "scene-one.01": camera }).success,
      ).toBe(false);
    }
    expect(cameraEditsSchema.safeParse({ Scene: {} }).success).toBe(false);
  });
});
