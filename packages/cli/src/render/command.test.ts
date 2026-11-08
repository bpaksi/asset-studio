import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../bin/cli.js";
import { clearRenderers, type Renderer, registerRenderer } from "./registry.js";

let dir: string;
let work: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "as-seam-")));
  work = join(dir, "work");
  mkdirSync(work);
  writeFileSync(
    join(dir, "asset-job.json"),
    JSON.stringify({
      schema: 1,
      story: "dracula",
      source: `sha256:${"b".repeat(64)}`,
      profiles: { dashboard: { width: 8, height: 4 } },
      cast: [],
      lines: [],
      pictures: [],
      moments: [],
      sounds: [],
    }),
  );
  clearRenderers();
});
afterEach(() => {
  clearRenderers();
  rmSync(dir, { recursive: true, force: true });
});

const cli = async (args: string[], withFolder = true) => {
  let out = "";
  let err = "";
  const code = await main(
    withFolder ? ["--work-folder", work, ...args] : args,
    {
      env: {
        PATH: process.env.PATH,
        ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg"),
      },
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

const ok = (kind: Renderer["kind"], calls: string[], ai = false): Renderer => ({
  kind,
  ai,
  render: () => {
    calls.push(`${ai ? "ai-" : ""}${kind}`);
    return { rendered: 2, failed: 0 };
  },
});

describe("render, nothing registered", () => {
  it("fails AS-CONFIG-1 with no work folder", async () => {
    const r = await cli(["render", "asset-job.json"], false);
    expect(r.code).toBe(3);
    expect(r.err).toContain("AS-CONFIG-1");
  });

  it("fails AS-RENDER-0 (not built yet)", async () => {
    const r = await cli(["render", "asset-job.json"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-RENDER-0: render is not built yet.");
  });

  it("parses --only, --only=, and --ai before failing", async () => {
    for (const args of [
      ["--only", "voice"],
      ["--only=picture"],
      ["--ai"],
      ["--only", "voice", "--ai"],
    ]) {
      const r = await cli(["render", "asset-job.json", ...args]);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.err).toContain("AS-RENDER-");
    }
  });

  it.each([
    [["render"]],
    [["render", "asset-job.json", "extra"]],
    [["render", "asset-job.json", "--only", "sound"]],
    [["render", "asset-job.json", "--only"]],
    [["render", "asset-job.json", "--ai=yes"]],
    [["render", "asset-job.json", "--out", "x"]],
    [["render", "asset-job.json", "--json"]],
  ])("%j is a usage error", async (args) => {
    const r = await cli(args);
    expect(r.code).toBe(2);
    expect(r.err).toContain("AS-USAGE-1");
  });

  it("--only voice with no voice renderer names the kind", async () => {
    registerRenderer(ok("picture", []));
    const r = await cli(["render", "asset-job.json", "--only", "voice"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-RENDER-3: No voice renderer is registered.");
  });

  it("--ai with no AI renderer fails coded", async () => {
    registerRenderer(ok("picture", []));
    const r = await cli(["render", "asset-job.json", "--ai"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-RENDER-3");
  });
});

describe("renderer registry", () => {
  it("runs registered renderers for the requested kinds only", async () => {
    const calls: string[] = [];
    registerRenderer(ok("voice", calls));
    registerRenderer(ok("picture", calls));
    registerRenderer(ok("picture", calls, true));
    expect((await cli(["render", "asset-job.json"])).code).toBe(0);
    expect(calls).toEqual(["voice", "picture"]);
    calls.length = 0;
    const r = await cli([
      "render",
      "asset-job.json",
      "--only",
      "picture",
      "--ai",
    ]);
    expect(r.code).toBe(0);
    expect(calls).toEqual(["picture", "ai-picture"]);
    expect(r.out).toBe("rendered 4, failed 0\n");
  });

  it("counts a failing renderer and still runs the next", async () => {
    const calls: string[] = [];
    registerRenderer({
      kind: "voice",
      render: () => {
        throw new Error("boom");
      },
    });
    registerRenderer({
      kind: "voice",
      render: () => ({ rendered: 1, failed: 2 }),
    });
    registerRenderer(ok("picture", calls));
    const r = await cli(["render", "asset-job.json"]);
    expect(calls).toEqual(["picture"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("AS-RENDER-1: voice renderer failed: boom");
    expect(r.err).toContain("AS-RENDER-2: 3 failed.");
    expect(r.out).toBe("rendered 3, failed 3\n");
  });
});
