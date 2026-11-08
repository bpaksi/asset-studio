import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexSchema, type Job, notesSchema } from "@asset-studio/formats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readIndex,
  readNotes,
  recordDraft,
  sha256,
  workPaths,
} from "./store.js";

const child = fileURLToPath(new URL("./contention-child.mjs", import.meta.url));

type Result = {
  exit: number | null;
  out: {
    ok: boolean;
    code?: string | null;
    message?: string;
    elapsedMs: number;
  };
};

/** Start a real node subprocess; resolves when it exits. */
function run(options: Record<string, unknown>): Promise<Result> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--conditions=development",
        child,
        JSON.stringify(options),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += d;
    });
    proc.stderr.on("data", (d) => {
      err += d;
    });
    proc.on("error", reject);
    proc.on("close", (exit) => {
      try {
        resolve({ exit, out: JSON.parse(out.trim().split("\n").pop() ?? "") });
      } catch {
        reject(new Error(`child gave no result (exit ${exit}): ${out} ${err}`));
      }
    });
  });
}

const job: Job = {
  schema: 1,
  story: "dracula",
  source: `sha256:${"a".repeat(64)}`,
  profiles: { dashboard: { width: 8, height: 4 } },
  cast: [{ id: "innkeeper", name: "Innkeeper", moods: ["neutral"] }],
  lines: [],
  pictures: [
    {
      id: "painting.a",
      kind: "painting",
      profiles: ["dashboard"],
      prompt: "a",
    },
    {
      id: "painting.b",
      kind: "painting",
      profiles: ["dashboard"],
      prompt: "b",
    },
    {
      id: "painting.f",
      kind: "painting",
      profiles: ["dashboard"],
      prompt: "f",
    },
    {
      id: "painting.r",
      kind: "painting",
      profiles: ["dashboard"],
      prompt: "r",
    },
  ],
  moments: [],
  sounds: [],
};

let dir: string;
let work: string;
let jobPath: string;
let signalDir: string;
const paths = () => workPaths(work, "dracula");
const other = () => workPaths(work, "other");

const draft = (p: ReturnType<typeof workPaths>, id: string) =>
  recordDraft(p, {
    id,
    kind: "painting",
    data: new TextEncoder().encode(id),
    ext: "webp",
    size: { width: 8, height: 4 },
    inputs: { id },
  });

/** Every file under a folder (not the lock) with its content hash. */
function snapshot(root: string, skip: (name: string) => boolean = () => false) {
  const result: Record<string, string> = {};
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!skip(entry.name)) result[full] = sha256(readFileSync(full));
    }
  };
  walk(root);
  return result;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "as-contend-"));
  work = join(dir, "work");
  signalDir = join(dir, "signals");
  mkdirSync(signalDir);
  jobPath = join(dir, "asset-job.json");
  writeFileSync(jobPath, JSON.stringify(job));
  writeFileSync(join(dir, "master.png"), "master bytes");
  for (const id of ["painting.a", "painting.b", "painting.f", "painting.r"]) {
    draft(paths(), id);
  }
  draft(other(), "painting.a");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Seed the sentinels through the public path, in a subprocess-free way. */
async function seedSentinels() {
  const holderless = { work, story: "dracula", jobPath, signalDir };
  expect(
    (await run({ ...holderless, op: "approve", id: "painting.f" })).exit,
  ).toBe(0);
  expect(
    (
      await run({
        ...holderless,
        op: "reject",
        id: "painting.r",
        note: "sentinel note",
      })
    ).exit,
  ).toBe(0);
}

const base = () => ({ work, story: "dracula", jobPath, signalDir });

function expectValidAndConsistent() {
  const index = indexSchema.parse(
    JSON.parse(readFileSync(paths().index, "utf8")),
  );
  const notes = notesSchema.parse(
    JSON.parse(readFileSync(paths().notes, "utf8")),
  );
  for (const [id, entry] of Object.entries(index)) {
    if (entry.status === "rejected") {
      expect(notes[id], `rejected ${id} has notes`).toEqual(entry.notes);
    }
  }
  for (const id of Object.keys(notes)) {
    expect(index[id]?.status, `notes for ${id} need a rejected entry`).toBe(
      "rejected",
    );
  }
  return { index, notes };
}

describe("two real processes on one story", () => {
  it("serialize: concurrent rejects of different ids keep both exact notes", async () => {
    await seedSentinels();
    const untouched = {
      other: snapshot(other().root),
      master: snapshot(
        dir,
        (n) => n !== "master.png" && n !== "asset-job.json",
      ),
      store: snapshot(paths().store),
    };
    const [holder, waiter] = await Promise.all([
      run({
        ...base(),
        op: "reject",
        id: "painting.a",
        note: "note A",
        role: "holder",
      }),
      run({
        ...base(),
        op: "reject",
        id: "painting.b",
        note: "note B",
        role: "waiter",
      }),
    ]);
    expect([holder.exit, waiter.exit]).toEqual([0, 0]);
    // The waiter really had to wait for the holder.
    expect(waiter.out.elapsedMs).toBeGreaterThanOrEqual(150);
    const { index, notes } = expectValidAndConsistent();
    expect(index["painting.a"]?.status).toBe("rejected");
    expect(index["painting.b"]?.status).toBe("rejected");
    expect(notes["painting.a"]).toEqual(["note A"]);
    expect(notes["painting.b"]).toEqual(["note B"]);
    expect(index["painting.f"]?.status).toBe("final");
    expect(notes["painting.r"]).toEqual(["sentinel note"]);
    expect(index["painting.r"]?.status).toBe("rejected");
    // Masters, job, store bytes and another story are byte-identical.
    expect(snapshot(other().root)).toEqual(untouched.other);
    expect(
      snapshot(dir, (n) => n !== "master.png" && n !== "asset-job.json"),
    ).toEqual(untouched.master);
    expect(snapshot(paths().store)).toEqual(untouched.store);
    expect(readdirSync(paths().root).sort()).toEqual([
      "index.json",
      "notes.json",
      "store",
    ]);
  });

  it("serialize: concurrent approve and reject of different ids both survive", async () => {
    await seedSentinels();
    const [holder, waiter] = await Promise.all([
      run({ ...base(), op: "approve", id: "painting.a", role: "holder" }),
      run({
        ...base(),
        op: "reject",
        id: "painting.b",
        note: "why B",
        role: "waiter",
      }),
    ]);
    expect([holder.exit, waiter.exit]).toEqual([0, 0]);
    const { index, notes } = expectValidAndConsistent();
    expect(index["painting.a"]?.status).toBe("final");
    expect(index["painting.b"]?.status).toBe("rejected");
    expect(notes).toEqual({
      "painting.b": ["why B"],
      "painting.r": ["sentinel note"],
    });
    expect(index["painting.f"]?.status).toBe("final");
  });

  it("coded failure: a contender that times out fails with AS-STORE-4, the holder's change survives, and a retry works", async () => {
    await seedSentinels();
    const before = snapshot(paths().store);
    const [holder, waiter] = await Promise.all([
      run({
        ...base(),
        op: "reject",
        id: "painting.a",
        note: "A",
        role: "holder",
        holdMs: 900,
      }),
      run({
        ...base(),
        op: "reject",
        id: "painting.b",
        note: "B",
        role: "waiter",
        lockTimeoutMs: 150,
      }),
    ]);
    expect(holder.exit).toBe(0);
    expect(waiter.exit).toBe(1);
    expect(waiter.out).toMatchObject({ ok: false, code: "AS-STORE-4" });
    let state = expectValidAndConsistent();
    expect(state.index["painting.b"]?.status).toBe("draft");
    expect(state.notes["painting.b"]).toBeUndefined();
    expect(state.notes["painting.a"]).toEqual(["A"]);
    expect(snapshot(paths().store)).toEqual(before);
    // No leftover lock: the failed contender released nothing it did not own,
    // and the holder released its own. A fresh process retries successfully.
    expect(readdirSync(paths().root)).not.toContain(".lock");
    const retry = await run({
      ...base(),
      op: "reject",
      id: "painting.b",
      note: "B",
    });
    expect(retry.exit).toBe(0);
    state = expectValidAndConsistent();
    expect(state.notes).toEqual({
      "painting.a": ["A"],
      "painting.b": ["B"],
      "painting.r": ["sentinel note"],
    });
    expect(state.index["painting.f"]?.status).toBe("final");
  });
});

describe("induced commit failure", () => {
  const cases = [
    {
      name: "reject, index.json commit fails",
      op: "reject",
      failOn: "index.json",
    },
    {
      name: "reject, notes.json commit fails (index already written)",
      op: "reject",
      failOn: "notes.json",
    },
    {
      name: "approve, index.json commit fails",
      op: "approve",
      failOn: "index.json",
    },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: files stay valid, consistent and unchanged; retry works`, async () => {
      await seedSentinels();
      // A peer mutation has already committed.
      expect(
        (await run({ ...base(), op: "reject", id: "painting.a", note: "peer" }))
          .exit,
      ).toBe(0);
      const filesBefore = snapshot(paths().root);
      const failed = await run({
        ...base(),
        op: c.op,
        id: "painting.b",
        note: "N",
        failOn: c.failOn,
      });
      expect(failed.exit).toBe(1);
      expect(failed.out).toMatchObject({ ok: false, code: "AS-STORE-5" });
      // Fresh-process view: byte-identical to before, no temp file, no lock.
      expect(snapshot(paths().root)).toEqual(filesBefore);
      const state = expectValidAndConsistent();
      expect(state.index["painting.b"]?.status).toBe("draft");
      expect(state.notes["painting.a"]).toEqual(["peer"]);
      // Released: the same mutation succeeds next time through the same path.
      const retry = await run({
        ...base(),
        op: c.op,
        id: "painting.b",
        note: "N",
      });
      expect(retry.exit).toBe(0);
      const after = expectValidAndConsistent();
      expect(after.index["painting.b"]?.status).toBe(
        c.op === "approve" ? "final" : "rejected",
      );
      expect(after.notes["painting.a"]).toEqual(["peer"]);
      expect(after.notes["painting.r"]).toEqual(["sentinel note"]);
      if (c.op === "reject") expect(after.notes["painting.b"]).toEqual(["N"]);
      expect(readIndex(paths())["painting.f"]?.status).toBe("final");
      expect(readNotes(paths())["painting.a"]).toEqual(["peer"]);
    });
  }
});
