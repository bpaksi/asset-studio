import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { recordDraft, workPaths } from "../store/store.js";

const cliRoot = resolve(import.meta.dirname, "..", "..");
const formatsRoot = resolve(cliRoot, "..", "formats");
const bin = join(cliRoot, "dist", "bin", "main.js");
const CONFIG_LINE =
  "Set the work folder: asset-studio config set workFolder <path>";

beforeAll(() => {
  // The subprocess tests run the built bin, so build formats then the CLI.
  for (const pkg of [formatsRoot, cliRoot]) {
    const built = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        join(pkg, "tsconfig.build.json"),
      ],
      { encoding: "utf8" },
    );
    if (built.status !== 0) {
      throw new Error(`build failed in ${pkg}: ${built.stdout}${built.stderr}`);
    }
  }
}, 180_000);

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  // realpath: macOS reports tmp as /private/var, and the child sees its cwd that way.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "as-cli-")));
  env = { PATH: process.env.PATH, ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: dir,
    env: { ...env, ...extraEnv },
    encoding: "utf8",
  });
  return {
    code: result.status,
    out: result.stdout,
    err: result.stderr,
  };
};

const jobPath = () => join(dir, "asset-job.json");
const writeJob = (extra: Record<string, unknown> = {}) =>
  writeFileSync(
    jobPath(),
    JSON.stringify({
      schema: 1,
      story: "dracula",
      source: `sha256:${"b".repeat(64)}`,
      profiles: { dashboard: { width: 8, height: 4 } },
      cast: [
        {
          id: "count",
          name: "Count",
          voice: { provider: "gemini-tts", voiceId: "Charon" },
          moods: ["neutral", "angry"],
        },
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
      sounds: [],
      ...extra,
    }),
  );

const draft = (workFolder: string, id: string) =>
  recordDraft(workPaths(workFolder, "dracula"), {
    id,
    kind: "painting",
    data: new TextEncoder().encode(id),
    ext: "webp",
    size: { width: 8, height: 4 },
    inputs: { id },
  });

describe("AS-CONFIG-1", () => {
  it.each([
    ["needs", ["needs", "asset-job.json"]],
    ["approve", ["approve", "asset-job.json", "painting.n1-house"]],
    [
      "reject",
      ["reject", "asset-job.json", "painting.n1-house", "--note", "x"],
    ],
    ["needs with no args", ["needs"]],
  ])("%s fails with the help line when no work folder is set", (_n, args) => {
    const r = run(args);
    expect(r.code).toBe(3);
    expect(r.out).toBe("");
    expect(r.err).toContain("AS-CONFIG-1");
    expect(r.err.split("\n")).toContain(CONFIG_LINE);
  });
});

describe("config", () => {
  it("sets, gets and persists the work folder per user", () => {
    const set = run(["config", "set", "workFolder", "wf"]);
    expect(set.code).toBe(0);
    expect(set.out).toBe(`${join(dir, "wf")}\n`);
    const got = run(["config", "get", "workFolder"]);
    expect(got).toMatchObject({ code: 0, out: `${join(dir, "wf")}\n` });
    expect(
      JSON.parse(readFileSync(join(dir, "cfg", "settings.json"), "utf8")),
    ).toEqual({ workFolder: join(dir, "wf") });
  });

  it("get with nothing set fails without AS-CONFIG-1 gating config", () => {
    const r = run(["config", "get", "workFolder"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not set");
  });

  it("rejects unknown keys and missing paths as usage errors", () => {
    expect(run(["config", "set", "color", "x"]).code).toBe(2);
    expect(run(["config", "set", "workFolder"]).code).toBe(2);
    expect(run(["config"]).code).toBe(2);
  });

  it("uses the platform default location when no override is given", () => {
    const home = join(dir, "home");
    const r = run(["config", "set", "workFolder", "wf"], {
      ASSET_STUDIO_CONFIG_DIR: "",
      HOME: home,
      XDG_CONFIG_HOME: "",
    });
    expect(r.code).toBe(0);
    const path =
      process.platform === "darwin"
        ? join(home, "Library", "Application Support")
        : process.platform === "win32"
          ? undefined
          : join(home, ".config");
    if (path !== undefined) {
      expect(
        JSON.parse(
          readFileSync(join(path, "asset-studio", "settings.json"), "utf8"),
        ),
      ).toEqual({ workFolder: join(dir, "wf") });
    }
  });
});

describe("needs", () => {
  it("lists every derived id as text, with the --work-folder override", () => {
    writeJob();
    run(["config", "set", "workFolder", "saved"]);
    const r = run(["needs", "asset-job.json", "--work-folder", "other"]);
    expect(r.code).toBe(0);
    const lines = r.out.trimEnd().split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^portrait\.count\s+portrait\s+missing$/);
    expect(r.out).toMatch(/glow\.n1-house\s+glow\s+missing/);
  });

  it("--json prints every id with kind, origin and status from the index", () => {
    writeJob();
    run(["config", "set", "workFolder", "wf"]);
    draft(join(dir, "wf"), "painting.n1-house");
    const r = run(["needs", "asset-job.json", "--json"]);
    expect(r.code).toBe(0);
    const list = JSON.parse(r.out) as { id: string; status: string }[];
    expect(list.map((n) => n.id)).toEqual([
      "portrait.count",
      "portrait.count~angry",
      "n1-house.02~vo-01",
      "painting.n1-house",
      "glow.n1-house",
    ]);
    expect(list.map((n) => n.status)).toEqual([
      "missing",
      "missing",
      "missing",
      "draft",
      "missing",
    ]);
    expect(list[0]).toEqual({
      id: "portrait.count",
      kind: "portrait",
      origin: "built",
      status: "missing",
    });
  });

  it("fails with AS-JOB codes for a missing, broken or invalid job", () => {
    run(["config", "set", "workFolder", "wf"]);
    expect(run(["needs", "nope.json"])).toMatchObject({ code: 1 });
    writeFileSync(jobPath(), "{");
    expect(run(["needs", "asset-job.json"]).err).toContain("AS-JOB-1");
    writeJob({ status: "final" });
    const bad = run(["needs", "asset-job.json"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("AS-JOB-2");
    expect(bad.err).toContain("status");
  });

  it("usage errors exit 2", () => {
    run(["config", "set", "workFolder", "wf"]);
    expect(run(["needs"]).code).toBe(2);
    expect(run(["needs", "a", "b"]).code).toBe(2);
    expect(run(["needs", "a", "--bogus"]).code).toBe(2);
    expect(run(["frobnicate"]).code).toBe(2);
    expect(run([]).code).toBe(2);
    expect(run(["--work-folder"]).code).toBe(2);
  });
});

describe("approve and reject", () => {
  const wf = () => join(dir, "wf");
  beforeEach(() => {
    writeJob();
    run(["config", "set", "workFolder", "wf"]);
    draft(wf(), "painting.n1-house");
  });

  it("approve sets final in index.json", () => {
    const r = run(["approve", "asset-job.json", "painting.n1-house"]);
    expect(r).toMatchObject({ code: 0, out: "painting.n1-house: final\n" });
    const index = JSON.parse(
      readFileSync(join(wf(), "dracula", "index.json"), "utf8"),
    );
    expect(index["painting.n1-house"].status).toBe("final");
    const needs = run(["needs", "asset-job.json", "--json"]);
    expect(
      (JSON.parse(needs.out) as { id: string; status: string }[]).find(
        (n) => n.id === "painting.n1-house",
      )?.status,
    ).toBe("final");
  });

  it("reject sets rejected and persists the note in index and notes.json", () => {
    const r = run([
      "reject",
      "asset-job.json",
      "painting.n1-house",
      "--note",
      "too dark",
    ]);
    expect(r).toMatchObject({ code: 0, out: "painting.n1-house: rejected\n" });
    const folder = join(wf(), "dracula");
    const index = JSON.parse(readFileSync(join(folder, "index.json"), "utf8"));
    expect(index["painting.n1-house"]).toMatchObject({
      status: "rejected",
      notes: ["too dark"],
    });
    expect(
      JSON.parse(readFileSync(join(folder, "notes.json"), "utf8")),
    ).toEqual({ "painting.n1-house": ["too dark"] });
  });

  it("accepts --note=text and honours --work-folder", () => {
    const r = run([
      "reject",
      "asset-job.json",
      "painting.n1-house",
      "--note=hazy",
      "--work-folder",
      wf(),
    ]);
    expect(r.code).toBe(0);
  });

  it("fails cleanly: reject without note, unknown id, missing asset", () => {
    expect(run(["reject", "asset-job.json", "painting.n1-house"]).code).toBe(2);
    expect(run(["approve", "asset-job.json", "painting.zzz"])).toMatchObject({
      code: 1,
    });
    expect(run(["approve", "asset-job.json", "glow.n1-house"]).err).toContain(
      "AS-ID-2",
    );
    expect(run(["approve", "asset-job.json", "painting.zzz"]).err).toContain(
      "AS-ID-1",
    );
    const index = JSON.parse(
      readFileSync(join(wf(), "dracula", "index.json"), "utf8"),
    );
    expect(index["painting.n1-house"].status).toBe("draft");
  });
});

describe("help", () => {
  it("--help prints usage and exits 0 even with no work folder", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("config set workFolder <path>");
  });
});
