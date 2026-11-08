#!/usr/bin/env node
// Packs the four packages, installs the tarballs into a fresh project with npm,
// and runs the installed `asset-studio` bin on the example job (needs, render,
// approve, export). No npm registry package for @asset-studio/* is needed.
// Run from the repo root after `pnpm install --frozen-lockfile`:
//   node scripts/smoke-pack.mjs
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const order = ["formats", "player", "cli", "studio"];
const ids = ["portrait.keeper", "painting.stair", "sound.door"];
const tmp = mkdtempSync(join(tmpdir(), "asset-studio-smoke-"));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
const fail = (message) => {
  console.error(`smoke: FAIL: ${message}`);
  process.exitCode = 1;
};

try {
  const tarballs = {};
  for (const name of order) {
    const dest = join(tmp, "tarballs", name);
    mkdirSync(dest, { recursive: true });
    run(
      "pnpm",
      ["--filter", `./packages/${name}`, "pack", "--pack-destination", dest],
      root,
    );
    const file = readdirSync(dest).find((f) => f.endsWith(".tgz"));
    if (!file) throw new Error(`no tarball for ${name}`);
    tarballs[name] = join(dest, file);
  }
  console.log("smoke: packed", order.join(", "));

  for (const [name, tgz] of Object.entries(tarballs)) {
    const json = run("tar", ["-xzOf", tgz, "package/package.json"], root);
    if (json.includes("workspace:"))
      fail(`${name} tarball still has a workspace: range`);
    if (JSON.parse(json).private === true) fail(`${name} tarball is private`);
  }

  const project = join(tmp, "project");
  mkdirSync(project);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "smoke", private: true, version: "0.0.0" }),
  );
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", ...order.map((n) => tarballs[n])],
    project,
  );

  const bin = join(project, "node_modules", ".bin", "asset-studio");
  if (!existsSync(bin))
    throw new Error("npm install did not link the asset-studio bin");

  const work = join(tmp, "work");
  const out = join(tmp, "exported");
  const job = join(root, "examples", "lantern-tale", "asset-job.json");
  const cli = (...args) => run(bin, ["--work-folder", work, ...args], project);

  const needs = cli("needs", job);
  for (const id of ids) {
    if (!new RegExp(`${id}\\s+\\S+\\s+missing`).test(needs))
      fail(`needs: ${id} should be missing:\n${needs}`);
  }
  const rendered = cli("render", job);
  if (!rendered.includes("rendered 3, failed 0")) fail(`render: ${rendered}`);
  for (const id of ids) cli("approve", job, id);
  const exported = cli("export", job, "--out", out);
  if (!exported.includes("exported 3 assets")) fail(`export: ${exported}`);

  const index = JSON.parse(
    readFileSync(join(out, "export-index.json"), "utf8"),
  );
  const got = Object.keys(index.assets).sort().join();
  if (got !== [...ids].sort().join()) fail(`export index ids: ${got}`);
  for (const [id, asset] of Object.entries(index.assets)) {
    if (!existsSync(join(out, asset.file)))
      fail(`export: missing file for ${id}`);
    if (asset.status !== "final") fail(`export: ${id} is ${asset.status}`);
  }

  run(
    "node",
    [
      "--input-type=module",
      "-e",
      'for (const m of ["formats", "player", "cli", "studio"]) await import("@asset-studio/" + m);',
    ],
    project,
  );
  console.log(
    "smoke: needs, render, approve, export ran from the installed tarballs",
  );

  // PENDING until the fake-provider switch merges (separate PR, feat/p2-fake-providers):
  // add a voiced line to a second example job and run
  //   ASSET_STUDIO_FAKE_PROVIDERS=1 asset-studio render <job>
  // then check the voice draft exists and exports.
  console.log(
    "smoke: PENDING voice/AI case (ASSET_STUDIO_FAKE_PROVIDERS=1 not merged yet)",
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
