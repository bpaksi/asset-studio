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

const cli = async (args: string[]) => {
  let out = "";
  let err = "";
  const code = await main(args, {
    env: { ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg") },
    cwd: dir,
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
  });
  return { code, out, err };
};

describe("studio (placeholder)", () => {
  it("runs with no work folder set (needsWorkFolder is false)", async () => {
    const r = await cli(["studio"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-STUDIO-0");
    expect(r.err).not.toContain("AS-CONFIG-1");
  });

  it("fails AS-STUDIO-0 when the folder is set", async () => {
    const r = await cli(["--work-folder", join(dir, "w"), "studio"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-STUDIO-0: studio is not built yet.");
  });

  it.each([[["studio", "x"]], [["studio", "--ai"]]])(
    "%j is a usage error",
    async (args) => {
      const r = await cli(["--work-folder", join(dir, "w"), ...args]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("AS-USAGE-1");
    },
  );

  it("--help lists the three new commands", async () => {
    const r = await cli(["--help"]);
    expect(r.code).toBe(0);
    for (const c of ["render <job>", "export <job>", "studio"]) {
      expect(r.out).toContain(c);
    }
  });
});
