// Test support: one real mutation in its own process. Argument: a JSON
// options string. Prints one JSON line and exits 0 on success, 1 on failure.
//   op: "approve" | "reject"; work, story, jobPath, id, note
//   signalDir + role "holder" | "waiter": holder takes the lock, waits until
//     the waiter has started its own attempt, holds for holdMs, then goes on
//   lockTimeoutMs: how long to wait for a held lock
//   failOn: file name (index.json | notes.json) whose commit throws
import { existsSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";

register("./ts-resolve-hooks.mjs", import.meta.url);
const options = JSON.parse(process.argv[2]);
const store = await import("./store.ts");
const needs = await import("../needs/needs.ts");

const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const touch = (name) => writeFileSync(join(options.signalDir, name), "x");

if (options.lockTimeoutMs !== undefined) {
  store.storeTestHooks.lockTimeoutMs = options.lockTimeoutMs;
}
if (options.failOn !== undefined) {
  store.storeTestHooks.beforeCommit = (path) => {
    if (path.endsWith(options.failOn)) throw new Error("injected commit fault");
  };
}
if (options.role === "holder") {
  store.storeTestHooks.afterLock = () => {
    touch("holder.locked");
    const limit = Date.now() + 10000;
    while (!existsSync(join(options.signalDir, "waiter.started"))) {
      if (Date.now() > limit) throw new Error("waiter never started");
      sleep(5);
    }
    sleep(options.holdMs ?? 300);
  };
}

try {
  const paths = store.workPaths(options.work, options.story);
  let startedAt = Date.now();
  if (options.role === "waiter") {
    const limit = Date.now() + 10000;
    while (!existsSync(join(options.signalDir, "holder.locked"))) {
      if (Date.now() > limit) throw new Error("holder never locked");
      sleep(5);
    }
    touch("waiter.started");
  }
  startedAt = Date.now();
  const job = needs.loadJob(options.jobPath);
  if (options.op === "approve") needs.approve(job, paths, options.id);
  else if (options.op === "reject")
    needs.reject(job, paths, options.id, options.note);
  else throw new Error(`unknown op ${options.op}`);
  console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - startedAt }));
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      code: error.code ?? null,
      message: error.message,
      elapsedMs: 0,
    }),
  );
  process.exitCode = 1;
}
