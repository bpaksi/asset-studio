import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../bin/cli.js";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "as-seam-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const cli = async (args: string[], withFolder = true) => {
  let out = "";
  let err = "";
  const code = await main(
    withFolder ? ["--work-folder", join(dir, "w"), ...args] : args,
    {
      env: { ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg") },
      cwd: dir,
      stdout: (t) => {
        out += t;
      },
      stderr: (t) => {
        err += t;
      },
    },
  );
  return { code, out, err };
};

describe("export (placeholder)", () => {
  it("fails AS-CONFIG-1 with no work folder", async () => {
    const r = await cli(["export", "j.json", "--out", "o"], false);
    expect(r.code).toBe(3);
    expect(r.err).toContain("AS-CONFIG-1");
  });

  it.each([
    [["export", "j.json", "--out", "o"]],
    [["export", "j.json", "--out=o", "--drafts"]],
  ])("%j fails AS-EXPORT-0", async (args) => {
    const r = await cli(args);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-EXPORT-0: export is not built yet.");
  });

  it.each([
    [["export"]],
    [["export", "j.json"]],
    [["export", "--out", "o"]],
    [["export", "j.json", "--out"]],
    [["export", "j.json", "--out", "o", "x"]],
    [["export", "j.json", "--out", "o", "--drafts=1"]],
    [["export", "j.json", "--out", "o", "--ai"]],
  ])("%j is a usage error", async (args) => {
    const r = await cli(args);
    expect(r.code).toBe(2);
    expect(r.err).toContain("AS-USAGE-1");
  });
});
