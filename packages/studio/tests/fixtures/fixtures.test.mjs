import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dir = new URL("../../test-fixtures/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const job = load("asset-job.json");
const cases = load("review-cases.json");
const fake = load("fake-provider.json");

const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const hasKey = (o, k) => JSON.stringify(o).includes(`"${k}"`);

// Ids the job gives plus the ones asset-studio builds (plan: Job contract).
const jobIds = [
  ...job.lines.map((l) => l.id),
  ...job.pictures.map((p) => p.id),
  ...job.sounds.map((s) => s.id),
];
const builtIds = [
  ...job.cast.flatMap((c) =>
    c.moods.map((m) =>
      m === "neutral" ? `portrait.${c.id}` : `portrait.${c.id}~${m}`,
    ),
  ),
  ...job.pictures
    .filter((p) => p.glow)
    .map((p) => `glow.${p.id.split(".")[1]}`),
];
const allIds = new Set([...jobIds, ...builtIds]);

test("job fixture follows the documented job contract", () => {
  assert.equal(job.schema, 1);
  assert.equal(job.story, "fixture-story");
  assert.match(job.source, /^sha256:/);
  assert.equal(
    hasKey(job, "status"),
    false,
    "no status field anywhere in the job (DEC-839)",
  );
  assert.equal(new Set(jobIds).size, jobIds.length, "no duplicate ids");
  for (const id of jobIds) {
    const [head, variant] = id.split("~");
    for (const part of [...head.split("."), ...(variant ? [variant] : [])])
      assert.match(part, kebab, id);
  }
  const speakers = new Map(job.cast.map((c) => [c.id, c]));
  for (const l of job.lines) {
    const s = speakers.get(l.speaker);
    assert.ok(s?.voice, `line ${l.id} speaker is cast and voiced`);
    assert.ok(s.moods.includes(l.mood), `line ${l.id} mood is the speaker's`);
  }
  for (const c of job.cast)
    for (const p of c.portraits ?? []) assert.ok(c.moods.includes(p.mood));
  for (const p of job.pictures) {
    assert.ok(p.source || p.prompt, p.id);
    for (const pr of p.profiles)
      assert.ok(job.profiles[pr], `${p.id} profile ${pr}`);
  }
  const pics = new Set(job.pictures.map((p) => p.id));
  const moves = [
    "push-in",
    "pull-out",
    "pan-left",
    "pan-right",
    "tilt-up",
    "tilt-down",
    "drift",
  ];
  for (const m of job.moments) {
    assert.ok(pics.has(m.picture));
    assert.ok(moves.includes(m.camera.move));
    assert.ok(["slow", "medium", "fast"].includes(m.camera.speed));
    const f = m.camera.focus;
    for (const k of ["x", "y", "w", "h"]) assert.ok(f[k] >= 0 && f[k] <= 1);
  }
});

test("fixture covers a voiced speaker, a voiceless cast member and a glow picture", () => {
  assert.ok(job.cast.some((c) => c.voice));
  assert.ok(job.cast.some((c) => !c.voice));
  assert.ok(job.pictures.some((p) => p.glow));
});

test("built ids match the documented ID rules", () => {
  assert.deepEqual([...builtIds].sort(), [...cases.builtIds].sort());
});

test("start state uses only the four documented statuses and known ids", () => {
  for (const [id, st] of Object.entries(cases.startState)) {
    assert.ok(cases.statuses.includes(st), `${id}: ${st}`);
    assert.ok(allIds.has(id), `${id} is in the job`);
  }
});

test("start state has draft and final review cases", () => {
  const seen = new Set(Object.values(cases.startState));
  for (const st of ["draft", "final", "rejected", "missing"])
    assert.ok(seen.has(st), st);
});

test("approval and rejection cases are consistent with the start state", () => {
  const byCase = new Set();
  for (const d of cases.decisions) {
    assert.ok(!byCase.has(d.case), "unique case names");
    byCase.add(d.case);
    assert.equal(cases.startState[d.id], d.from, d.case);
    assert.equal(d.to, d.action === "approve" ? "final" : "rejected", d.case);
    if (d.action === "reject") assert.ok(d.note, "reject carries a note");
    else assert.equal(d.note, undefined);
  }
  assert.ok(cases.decisions.some((d) => d.action === "approve"));
  assert.ok(cases.decisions.some((d) => d.action === "reject"));
});

test('redo case matches the "redo <ID>: <note>" form', () => {
  const r = cases.redo;
  assert.ok(allIds.has(r.id));
  assert.equal(r.entry, `redo ${r.id}: ${r.note}`);
  assert.deepEqual(r.afterNextRender, {
    noteCleared: true,
    newDraftStored: true,
  });
});

test("draft display expectations match the job", () => {
  const d = cases.draftDisplay;
  const line = job.lines.find((l) => l.id === "scene-a.02~vo-01");
  assert.equal(cases.startState[line.id], "draft");
  assert.equal(d[line.id].caption, line.text);
  const pic = job.pictures.find((p) => p.id === "painting.stair");
  assert.deepEqual(
    d["painting.stair"].sizes,
    pic.profiles.map((p) => [job.profiles[p].width, job.profiles[p].height]),
  );
  assert.deepEqual(d["portrait.narrator~angry"].size, [
    job.profiles.portrait.width,
    job.profiles.portrait.height,
  ]);
  assert.equal(d["glow.stair"].overlays, "painting.stair");
});

test("fake provider descriptors match the job", () => {
  const line = job.lines[0];
  assert.equal(fake.voice[line.id].text, line.text);
  const { portrait, dashboard } = job.profiles;
  assert.deepEqual(fake.image["painting.stair"], {
    width: dashboard.width,
    height: dashboard.height,
  });
  assert.equal(
    fake.image["glow.stair"].width,
    dashboard.width,
    "glow mask at the painting size",
  );
  assert.equal(fake.image["glow.stair"].greyscale, true);
  for (const id of [
    "portrait.narrator",
    "portrait.bystander",
    "portrait.bystander~scared",
  ]) {
    assert.deepEqual(fake.image[id], {
      width: portrait.width,
      height: portrait.height,
    });
  }
});
