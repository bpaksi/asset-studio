import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "@asset-studio/formats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readIndex,
  readNotes,
  recordDraft,
  workPaths,
} from "../store/store.js";
import {
  approve,
  assetKeys,
  computeNeeds,
  formatNeeds,
  loadJob,
  reject,
} from "./needs.js";

/** Generated fixture: a voiced speaker, a voiceless member, a glow picture. */
const makeJob = (): Job => ({
  schema: 1,
  story: "dracula",
  source: `sha256:${"a".repeat(64)}`,
  profiles: { dashboard: { width: 8, height: 4 } },
  cast: [
    {
      id: "count",
      name: "The Count",
      voice: { provider: "gemini-tts", voiceId: "Charon" },
      moods: ["neutral", "angry"],
    },
    { id: "innkeeper", name: "Innkeeper", moods: ["neutral"] },
  ],
  lines: [{ id: "n1-house.02~vo-01", speaker: "count", text: "Late." }],
  pictures: [
    {
      id: "painting.n1-house",
      kind: "painting",
      profiles: ["dashboard"],
      prompt: "a stair",
      glow: true,
    },
  ],
  moments: [],
  sounds: [{ id: "sound.door", kind: "effect", source: "sfx/door.wav" }],
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "as-needs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const draftOf = (paths: ReturnType<typeof workPaths>, id: string) =>
  recordDraft(paths, {
    id,
    kind: "painting",
    data: new TextEncoder().encode(id),
    ext: "webp",
    size: { width: 8, height: 4 },
    inputs: { id },
  });

describe("loadJob", () => {
  it("loads a valid job", () => {
    const path = join(dir, "asset-job.json");
    writeFileSync(path, JSON.stringify(makeJob()));
    expect(loadJob(path).story).toBe("dracula");
  });
  it("reports unreadable, non-JSON and invalid jobs with codes", () => {
    expect(() => loadJob(join(dir, "nope.json"))).toThrow(/Cannot read job/);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{");
    expect(() => loadJob(bad)).toThrow(/not valid JSON/);
    writeFileSync(bad, JSON.stringify({ ...makeJob(), status: "final" }));
    try {
      loadJob(bad);
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe("AS-JOB-2");
      expect(
        (error as { extraLines: string[] }).extraLines.join("\n"),
      ).toContain("status");
    }
  });
});

describe("computeNeeds", () => {
  it("lists every derived id as missing with no index", () => {
    const needs = computeNeeds(makeJob(), workPaths(dir, "dracula"));
    expect(needs.map((n) => [n.id, n.kind, n.status])).toEqual([
      ["portrait.count", "portrait", "missing"],
      ["portrait.count~angry", "portrait", "missing"],
      ["portrait.innkeeper", "portrait", "missing"],
      ["n1-house.02~vo-01", "line", "missing"],
      ["painting.n1-house", "painting", "missing"],
      ["glow.n1-house", "glow", "missing"],
      ["sound.door", "effect", "missing"],
    ]);
  });

  it("reads status from the index and formats text columns", () => {
    const paths = workPaths(dir, "dracula");
    draftOf(paths, "painting.n1-house");
    const needs = computeNeeds(makeJob(), paths);
    expect(needs.find((n) => n.id === "painting.n1-house")?.status).toBe(
      "draft",
    );
    const text = formatNeeds(needs);
    expect(text.split("\n")).toHaveLength(needs.length + 1);
    expect(text).toMatch(/painting\.n1-house\s+painting\s+draft\n/);
    expect(formatNeeds([])).toBe("");
  });
});

describe("approve and reject", () => {
  it("approve sets final in the index only", () => {
    const paths = workPaths(dir, "dracula");
    draftOf(paths, "painting.n1-house");
    approve(makeJob(), paths, "painting.n1-house");
    expect(readIndex(paths)["painting.n1-house"]?.status).toBe("final");
    expect(readNotes(paths)).toEqual({});
  });

  it("reject sets rejected and writes the note to index and notes.json", () => {
    const paths = workPaths(dir, "dracula");
    draftOf(paths, "painting.n1-house");
    reject(makeJob(), paths, "painting.n1-house", " too dark ");
    reject(makeJob(), paths, "painting.n1-house", "still dark");
    const entry = readIndex(paths)["painting.n1-house"];
    expect(entry?.status).toBe("rejected");
    expect(entry?.notes).toEqual(["too dark", "still dark"]);
    expect(readNotes(paths)).toEqual({
      "painting.n1-house": ["too dark", "still dark"],
    });
    expect(JSON.parse(readFileSync(paths.notes, "utf8"))).toBeTruthy();
  });

  it("refuses ids outside the job, missing assets and empty notes", () => {
    const paths = workPaths(dir, "dracula");
    expect(() => approve(makeJob(), paths, "painting.other")).toThrow(
      /not an asset ID/,
    );
    expect(() => approve(makeJob(), paths, "painting.n1-house")).toThrow(
      /no file yet/,
    );
    draftOf(paths, "painting.n1-house");
    expect(() => reject(makeJob(), paths, "painting.n1-house", "  ")).toThrow(
      /--note/,
    );
    expect(readIndex(paths)["painting.n1-house"]?.status).toBe("draft");
  });

  it("leaves a corrupt index alone", () => {
    const paths = workPaths(dir, "dracula");
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.index, "{");
    expect(() => approve(makeJob(), paths, "painting.n1-house")).toThrow(
      /valid work folder file/,
    );
    expect(readFileSync(paths.index, "utf8")).toBe("{");
  });
});

describe("assetKeys (multi-profile expansion)", () => {
  const multi = (): Job => ({
    ...makeJob(),
    profiles: {
      dashboard: { width: 8, height: 4 },
      ipad: { width: 4, height: 8 },
    },
    pictures: [
      {
        id: "painting.n1-house",
        kind: "painting",
        profiles: ["dashboard", "ipad"],
        source: "a.png",
        glow: true,
      },
      {
        id: "foe.shade",
        kind: "foe",
        profiles: ["ipad"],
        source: "b.png",
      },
    ],
  });

  it("keys 2+ profiles as <id>~<profile> and keeps one profile bare", () => {
    const keys = assetKeys(multi()).map((k) => k.key);
    expect(keys).toContain("painting.n1-house~dashboard");
    expect(keys).toContain("painting.n1-house~ipad");
    expect(keys).toContain("glow.n1-house~dashboard");
    expect(keys).toContain("glow.n1-house~ipad");
    expect(keys).toContain("foe.shade");
    expect(keys).not.toContain("painting.n1-house");
    expect(keys).toContain("portrait.count~angry");
  });

  it("lists, approves and rejects expanded keys", () => {
    const paths = workPaths(dir, "dracula");
    const job = multi();
    expect(
      computeNeeds(job, paths).find((n) => n.id === "foe.shade")?.status,
    ).toBe("missing");
    draftOf(paths, "painting.n1-house~ipad");
    approve(job, paths, "painting.n1-house~ipad");
    expect(readIndex(paths)["painting.n1-house~ipad"]?.status).toBe("final");
    expect(() => approve(job, paths, "painting.n1-house")).toThrow(
      /not an asset ID/,
    );
  });
});
