import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readIndex,
  readNotes,
  savedWorkFolder,
  workPaths,
} from "@asset-studio/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Library, realLibrary } from "./library.js";
import { type StudioServer, startStudio } from "./server.js";
import {
  buildWorkspace,
  hashTree,
  sha256,
  type Workspace,
} from "./testing/workspace.js";

// biome-ignore lint/suspicious/noExplicitAny: parsed test JSON
type Json = any;

let ws: Workspace;
let studio: StudioServer;
let logged: string[];
let running = false;

beforeEach(() => {
  ws = buildWorkspace();
  logged = [];
});
afterEach(async () => {
  if (running) await studio.close();
  running = false;
  ws.cleanup();
});

const boot = async (
  opts: { library?: Library; folder?: string | null } = {},
) => {
  studio = await startStudio({
    env: ws.env,
    cwd: ws.root,
    workFolder: opts.folder === null ? undefined : (opts.folder ?? ws.work),
    ...(opts.library ? { library: opts.library } : {}),
    stderr: (t) => logged.push(t),
  });
  running = true;
  return studio;
};

const get = async (path: string) => {
  const res = await fetch(new URL(path, studio.url));
  return { res, json: (await res.json()) as Json };
};
const post = async (path: string, body: unknown) => {
  const res = await fetch(new URL(path, studio.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: (await res.json()) as Json };
};

const paths = () => workPaths(ws.work, "fixture-story");
const reviewRow = async (key: string) => {
  const { json } = await get(
    `/api/review?job=${encodeURIComponent(ws.jobPath)}`,
  );
  return json.rows.find((r: Json) => r.key === key);
};
const decision = async (
  action: "approve" | "reject",
  key: string,
  extra: Record<string, unknown> = {},
) => {
  const row = await reviewRow(key);
  return post(`/api/${action}`, {
    job: ws.jobPath,
    id: key,
    file: row?.file ?? null,
    status: row?.status ?? "missing",
    ...extra,
  });
};

describe("S7-01 loopback only", () => {
  it("listens on 127.0.0.1 and nowhere else", async () => {
    await boot();
    expect(studio.address).toBe("127.0.0.1");
    expect(new URL(studio.url).hostname).toBe("127.0.0.1");
  });

  it("refuses a connection on any non-loopback address of this machine", async () => {
    await boot();
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal);
    if (external === undefined) return; // no external interface here (CI containers have one)
    const outcome = await new Promise<string>((done) => {
      const socket = new Socket();
      socket.once("connect", () => {
        socket.destroy();
        done("connected");
      });
      socket.once("error", (e: NodeJS.ErrnoException) =>
        done(e.code ?? "error"),
      );
      socket.connect(studio.port, external.address);
    });
    expect(outcome).toBe("ECONNREFUSED");
  });

  it("rejects a foreign Host header (DNS rebinding) with AS-STUDIO-7, and logs it", async () => {
    await boot();
    const status = await new Promise<{ code: number; body: string }>((done) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: studio.port,
          path: "/api/state",
          headers: { host: `evil.example:${studio.port}` },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => done({ code: res.statusCode ?? 0, body }));
        },
      );
      req.end();
    });
    expect(status.code).toBe(403);
    expect(status.body).toContain("AS-STUDIO-7");
    expect(logged.join("")).toContain("AS-STUDIO-7");
  });

  it("rejects a cross-origin POST", async () => {
    await boot();
    const res = await fetch(new URL("/api/config", studio.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: JSON.stringify({ workFolder: ws.work }),
    });
    expect(res.status).toBe(403);
    expect(savedWorkFolder(ws.env)).toBeUndefined();
  });
});

describe("S7-02 config through the library", () => {
  it("with no work folder, state is empty and the review is refused with AS-CONFIG-1", async () => {
    await boot({ folder: null });
    const { json } = await get("/api/state");
    expect(json.workFolder).toBeNull();
    const r = await get(`/api/review?job=${encodeURIComponent(ws.jobPath)}`);
    expect(r.json.error.code).toBe("AS-CONFIG-1");
  });

  it("saves a valid folder with the library's setWorkFolder; the settings file proves it", async () => {
    const setWorkFolder = vi.fn(realLibrary.setWorkFolder);
    await boot({ folder: null, library: { ...realLibrary, setWorkFolder } });
    const { res, json } = await post("/api/config", { workFolder: ws.work });
    expect(res.status).toBe(200);
    expect(setWorkFolder).toHaveBeenCalledWith(ws.env, ws.work, ws.root);
    expect(savedWorkFolder(ws.env)).toBe(ws.work);
    expect(json.workFolder).toBe(ws.work);
    expect((await get("/api/state")).json.workFolder).toBe(ws.work);
  });

  it("invalid paths show their code and keep the saved setting", async () => {
    await boot({ folder: null });
    await post("/api/config", { workFolder: ws.work });
    const before = readFileSync(join(ws.cfg, "settings.json"), "utf8");
    const empty = await post("/api/config", { workFolder: "  " });
    expect(empty.json.error.code).toBe("AS-USAGE-1");
    const file = await post("/api/config", { workFolder: ws.jobPath });
    expect(file.json.error.code).toBe("AS-STUDIO-2");
    const gone = await post("/api/config", {
      workFolder: join(ws.root, "nope"),
    });
    expect(gone.json.error.code).toBe("AS-STUDIO-2");
    expect(readFileSync(join(ws.cfg, "settings.json"), "utf8")).toBe(before);
    expect(logged.join("")).toContain("AS-STUDIO-2");
  });

  it("a settings file that cannot be written shows AS-STUDIO-10 and keeps the valid setting", async () => {
    await boot({ folder: null });
    await post("/api/config", { workFolder: ws.work });
    const before = readFileSync(join(ws.cfg, "settings.json"), "utf8");
    // The library writes settings.json.<pid>.tmp first; a folder in its place makes that fail.
    mkdirSync(join(ws.cfg, `settings.json.${process.pid}.tmp`));
    const other = await post("/api/config", { workFolder: ws.root });
    expect(other.json.error.code).toBe("AS-STUDIO-10");
    expect(readFileSync(join(ws.cfg, "settings.json"), "utf8")).toBe(before);
    expect(savedWorkFolder(ws.env)).toBe(ws.work);
  });

  it("a corrupt settings file is reported (AS-CONFIG-2), never overwritten", async () => {
    await boot({ folder: null });
    writeFileSync(join(ws.cfg, "settings.json"), "{ not json");
    const r = await post("/api/config", { workFolder: ws.work });
    expect(r.json.error.code).toBe("AS-CONFIG-2");
    expect(readFileSync(join(ws.cfg, "settings.json"), "utf8")).toBe(
      "{ not json",
    );
  });
});

describe("S7-03 review model", () => {
  it("lists every key with its status; multi-profile pictures get per-profile keys and declared sizes", async () => {
    await boot();
    const { json } = await get(
      `/api/review?job=${encodeURIComponent(ws.jobPath)}`,
    );
    const byKey = Object.fromEntries(json.rows.map((r: Json) => [r.key, r]));
    expect(new Set(json.rows.map((r: Json) => r.status))).toEqual(
      new Set(["missing", "draft", "final", "rejected"]),
    );
    expect(byKey["foe.shade~dashboard"].declared).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(byKey["foe.shade~ipad"].declared).toEqual({
      width: 1640,
      height: 2360,
    });
    expect(byKey["portrait.narrator~angry"].declared).toEqual({
      width: 720,
      height: 900,
    });
    expect(byKey["painting.stair"].declared).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(byKey["scene-a.02~vo-01"].caption).toBe(
      "You come late. [pause 0.4] The others did not.",
    );
    expect(byKey["glow.stair"].overlay.key).toBe("painting.stair");
    // Unknown is unavailable, not zero.
    expect(byKey["portrait.bystander"].size).toBeNull();
    expect(byKey["portrait.bystander"].file).toBeNull();
  });

  it("a glow mask follows the library's keys: one per profile when its painting has 2+", async () => {
    const job = JSON.parse(readFileSync(ws.jobPath, "utf8"));
    job.pictures[0].profiles = ["dashboard", "ipad"];
    writeFileSync(ws.jobPath, JSON.stringify(job));
    await boot();
    const { json } = await get(
      `/api/review?job=${encodeURIComponent(ws.jobPath)}`,
    );
    const byKey = Object.fromEntries(json.rows.map((r: Json) => [r.key, r]));
    expect(Object.keys(byKey)).toEqual(
      expect.arrayContaining([
        "painting.stair~dashboard",
        "painting.stair~ipad",
        "glow.stair~dashboard",
        "glow.stair~ipad",
      ]),
    );
    expect(byKey["glow.stair"]).toBeUndefined();
    expect(byKey["glow.stair~ipad"].overlay.key).toBe("painting.stair~ipad");
    expect(byKey["glow.stair~ipad"].declared).toEqual({
      width: 1640,
      height: 2360,
    });
  });

  it("serves store bytes exactly, with ranges", async () => {
    await boot();
    const row = await reviewRow("scene-a.02~vo-01");
    const res = await fetch(new URL(row.mediaUrl, studio.url));
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get("content-type")).toBe("audio/mp4");
    expect(sha256(bytes)).toBe(row.file.split(".")[0]);
    const part = await fetch(new URL(row.mediaUrl, studio.url), {
      headers: { range: "bytes=0-7" },
    });
    expect(part.status).toBe(206);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(bytes.subarray(0, 8));
  });

  it("a corrupt store file answers AS-STORE-1 and a missing one AS-STUDIO-3, with no bytes", async () => {
    await boot();
    const row = await reviewRow("painting.stair");
    writeFileSync(join(ws.storeDir, row.file), "garbage");
    const bad = await get(row.mediaUrl);
    expect(bad.res.status).toBe(422);
    expect(bad.json.error.code).toBe("AS-STORE-1");
    const gone = await get(`/media/fixture-story/${"0".repeat(64)}.webp`);
    expect(gone.json.error.code).toBe("AS-STUDIO-3");
    const traversal = await get("/media/fixture-story/..%2Findex.json");
    expect(traversal.json.error.code).toBe("AS-STORE-1");
  });
});

describe("S7-05 approve and reject through the library", () => {
  it("approve calls the library once and only the intended entry changes", async () => {
    const approve = vi.fn(realLibrary.approve);
    await boot({ library: { ...realLibrary, approve } });
    const before = hashTree(ws.root);
    const idxBefore = readIndex(paths());
    const { res } = await decision("approve", "scene-a.02~vo-01");
    expect(res.status).toBe(200);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0]?.[2]).toBe("scene-a.02~vo-01");
    const idxAfter = readIndex(paths());
    expect(idxAfter["scene-a.02~vo-01"]?.status).toBe("final");
    expect({
      ...idxAfter,
      "scene-a.02~vo-01": { ...idxAfter["scene-a.02~vo-01"], status: "draft" },
    }).toEqual(idxBefore);
    const after = hashTree(ws.root);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed).toEqual(["work/fixture-story/index.json"]);
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  it("reject stores the exact note in the entry and in notes.json", async () => {
    const reject = vi.fn(realLibrary.reject);
    await boot({ library: { ...realLibrary, reject } });
    const before = hashTree(ws.root);
    const note = "too dark, lighter dawn";
    const { res } = await decision("reject", "painting.stair", { note });
    expect(res.status).toBe(200);
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0]?.[3]).toBe(note);
    expect(readIndex(paths())["painting.stair"]).toMatchObject({
      status: "rejected",
      notes: [note],
    });
    expect(readNotes(paths())["painting.stair"]).toEqual([note]);
    const after = hashTree(ws.root);
    const changed = Object.keys(after)
      .filter((k) => after[k] !== before[k])
      .sort();
    expect(changed).toEqual([
      "work/fixture-story/index.json",
      "work/fixture-story/notes.json",
    ]);
  });

  it("a per-profile key (foe.shade~ipad) can be rejected through the library", async () => {
    await boot();
    const { res } = await decision("reject", "foe.shade~ipad", {
      note: "wrong blue",
    });
    expect(res.status).toBe(200);
    expect(readIndex(paths())["foe.shade~ipad"]?.status).toBe("rejected");
    expect(readNotes(paths())["foe.shade~ipad"]).toEqual(["wrong blue"]);
    expect(readIndex(paths())["foe.shade~dashboard"]?.status).toBe("final");
  });

  it("a reject with no note fails AS-USAGE-1 and changes nothing", async () => {
    await boot();
    const before = hashTree(ws.root);
    const { json } = await decision("reject", "painting.stair", { note: "  " });
    expect(json.error.code).toBe("AS-USAGE-1");
    expect(hashTree(ws.root)).toEqual(before);
  });

  it("looking (review, media) changes nothing on disk", async () => {
    await boot();
    const before = hashTree(ws.root);
    const { json } = await get(
      `/api/review?job=${encodeURIComponent(ws.jobPath)}`,
    );
    for (const row of json.rows)
      if (row.mediaUrl) await get(row.mediaUrl).catch(() => {});
    expect(hashTree(ws.root)).toEqual(before);
  });
});

describe("S7-06 failure and stale review", () => {
  it("an ID the job no longer has fails AS-ID-1; a missing asset AS-ID-2; neither saves", async () => {
    await boot();
    const before = hashTree(ws.root);
    const ghost = await post("/api/approve", {
      job: ws.jobPath,
      id: "ghost.nothing",
      file: null,
      status: "missing",
    });
    expect(ghost.json.error.code).toBe("AS-ID-1");
    const missing = await post("/api/approve", {
      job: ws.jobPath,
      id: "portrait.bystander",
      file: null,
      status: "missing",
    });
    expect(missing.json.error.code).toBe("AS-ID-2");
    expect(hashTree(ws.root)).toEqual(before);
    expect(logged.join("")).toContain("AS-ID-1");
  });

  it("approving a corrupt store file is refused (AS-STORE-1) and stays draft", async () => {
    await boot();
    const row = await reviewRow("painting.stair");
    writeFileSync(join(ws.storeDir, row.file), "garbage");
    const { json } = await decision("approve", "painting.stair");
    expect(json.error.code).toBe("AS-STORE-1");
    expect(readIndex(paths())["painting.stair"]?.status).toBe("draft");
  });

  it("a bad job path shows the library's code", async () => {
    await boot();
    const r = await get(
      `/api/review?job=${encodeURIComponent(join(ws.root, "none.json"))}`,
    );
    expect(r.json.error.code).toBe("AS-JOB-1");
    writeFileSync(join(ws.root, "bad.json"), "{}");
    const bad = await get(
      `/api/review?job=${encodeURIComponent(join(ws.root, "bad.json"))}`,
    );
    expect(bad.json.error.code).toBe("AS-JOB-2");
  });

  it("an induced save failure (the story lock cannot be taken) shows its code, saves nothing and never reports final", async () => {
    await boot();
    const row = await reviewRow("painting.stair");
    // A regular file where the lock folder must be made: no permissions involved.
    writeFileSync(join(ws.work, "fixture-story", ".lock"), "stuck");
    const before = hashTree(ws.root);
    const { json } = await decision("approve", "painting.stair");
    expect(json.error.code).toBe("AS-STORE-4");
    expect(json.ok).toBeUndefined();
    expect(hashTree(ws.root)).toEqual(before);
    expect(readIndex(paths())["painting.stair"]?.file).toBe(row.file);
    expect(readIndex(paths())["painting.stair"]?.status).toBe("draft");
  }, 30000);

  it("a client error report is logged on one line with control characters removed", async () => {
    await boot();
    await post("/api/client-error", {
      code: "AS-STUDIO-5\nAS-FAKE-1: forged",
      message: "bad\r\nline\u0007 two",
    });
    const line = logged.join("");
    expect(line.match(/\n/g)?.length).toBe(1);
    expect(line).not.toContain("\u0007");
    expect(line).toContain("AS-STUDIO-5");
  });

  it("a stale review (the draft was re-rendered since it was opened) is not approved", async () => {
    await boot();
    const opened = await reviewRow("painting.stair");
    // A render makes a new draft while the review is open.
    const idx = JSON.parse(readFileSync(ws.indexPath, "utf8"));
    idx["painting.stair"].file = ws.put("glow-stair-shifted.webp", "webp");
    idx["painting.stair"].inputsHash = `sha256:${sha256("new inputs")}`;
    writeFileSync(ws.indexPath, JSON.stringify(idx, null, 2));
    const before = hashTree(ws.root);
    const { res, json } = await post("/api/approve", {
      job: ws.jobPath,
      id: "painting.stair",
      file: opened.file,
      status: opened.status,
    });
    expect(res.status).toBe(409);
    expect(json.error.code).toBe("AS-STUDIO-6");
    expect(hashTree(ws.root)).toEqual(before);
    // After looking again (fresh file name), the approval goes through.
    const fresh = await reviewRow("painting.stair");
    expect(fresh.file).not.toBe(opened.file);
    expect((await decision("approve", "painting.stair")).res.status).toBe(200);
  });

  it("two simultaneous approvals: one wins, the other is a stale conflict (AS-STUDIO-6)", async () => {
    await boot();
    const row = await reviewRow("portrait.narrator~angry");
    const body = {
      job: ws.jobPath,
      id: "portrait.narrator~angry",
      file: row.file,
      status: row.status,
    };
    const both = await Promise.all([
      post("/api/approve", body),
      post("/api/reject", { ...body, note: "no" }),
    ]);
    const codes = both.map((b) => b.json.error?.code ?? "ok").sort();
    expect(codes).toEqual(["AS-STUDIO-6", "ok"]);
    const entry = readIndex(paths())["portrait.narrator~angry"];
    const winner = both.findIndex((b) => b.json.ok === true);
    expect(entry?.status).toBe(winner === 0 ? "final" : "rejected");
  });

  it("an unreadable request is AS-STUDIO-4 and a stray route AS-STUDIO-8", async () => {
    await boot();
    const res = await fetch(new URL("/api/approve", studio.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    expect(((await res.json()) as Json).error.code).toBe("AS-STUDIO-4");
    expect((await get("/nope")).json.error.code).toBe("AS-STUDIO-8");
  });
});

describe("the studio never writes the work folder itself", () => {
  it("studio source has no file-writing calls (writes go through the CLI library)", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(
        /writeFile|appendFile|renameSync|unlinkSync|rmSync|mkdirSync|copyFile|createWriteStream|openSync|symlinkSync|truncate/,
      );
    }
    expect(existsSync(join(dir, "server.ts"))).toBe(true);
  });
});
