// Browser tests at exactly 1440x900 (Playwright, Chromium). The main flow starts
// the studio through the real CLI entry point (a child process) and drives the
// page as a person would. Media are the committed tiny WebP/m4a/wav fixtures.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readIndex,
  readNotes,
  savedWorkFolder,
  setWorkFolder,
  workPaths,
} from "@asset-studio/cli";
import { readImageInfo } from "@asset-studio/formats";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type StudioServer, startStudio } from "./server.js";
import {
  buildWorkspace,
  hashTree,
  MEDIA,
  sha256,
  type Workspace,
} from "./testing/workspace.js";

const VIEWPORT = { width: 1440, height: 900 };
const evidenceDir =
  process.env.STUDIO_EVIDENCE_DIR ??
  mkdtempSync(join(tmpdir(), "as-evidence-"));
mkdirSync(evidenceDir, { recursive: true });
const evidence: Record<string, unknown> = { viewport: VIEWPORT };

const cliMain = fileURLToPath(
  new URL("../../cli/src/bin/main.ts", import.meta.url),
);
const registerHooks = fileURLToPath(
  new URL("./testing/e2e-register.mjs", import.meta.url),
);

let browser: Browser;
let context: BrowserContext;
const pageErrors: string[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
});
afterAll(async () => {
  writeFileSync(
    join(evidenceDir, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await browser?.close();
});

async function newPage(): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate("window.scrollTo(0, 0)");
  const buffer = await page.screenshot({ path: join(evidenceDir, name) });
  const info = readImageInfo(buffer);
  expect([info?.width, info?.height]).toEqual([1440, 900]);
}

const screen = (under: number, mask: number) =>
  Math.round(255 - ((255 - under) * (255 - mask)) / 255);

/** Decode a PNG in a blank page and read pixels. */
async function samplePng(
  png: Buffer,
  points: [number, number][],
): Promise<number[][]> {
  const page = await context.newPage();
  try {
    const script = `(async () => {
      const blob = await (await fetch("data:image/png;base64,${png.toString("base64")}")).blob();
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      return ${JSON.stringify(points)}.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    })()`;
    return (await page.evaluate(script)) as number[][];
  } finally {
    await page.close();
  }
}

const near = (actual: number[] | undefined, expected: number[], tol = 3) =>
  actual !== undefined &&
  expected.every((v, i) => Math.abs((actual[i] ?? -999) - v) <= tol);

// Known layout of the committed fixtures (see test-fixtures/media/make-media.py).
const BASE = [30, 60, 120];
const LIT = { x: 1200, y: 300, w: 300, h: 260 };
const MASK_GRAY = 200;
const litColour = BASE.map((c) => screen(c, MASK_GRAY));

/** What the overlay must look like: lit rectangle lighter, everything else the painting. */
async function assertMaskOverlay(stage: Buffer, lit: typeof LIT) {
  const inside: [number, number][] = [
    [lit.x + 5, lit.y + 5],
    [lit.x + lit.w - 6, lit.y + lit.h - 6],
    [lit.x + lit.w / 2, lit.y + lit.h / 2],
  ];
  const outside: [number, number][] = [
    [lit.x - 6, lit.y + lit.h / 2],
    [lit.x + lit.w + 5, lit.y + lit.h / 2],
    [lit.x + lit.w / 2, lit.y - 6],
    [lit.x + lit.w / 2, lit.y + lit.h + 5],
    [250, 800],
  ];
  const painting: [number, number][] = [
    [10, 10], // yellow bar
    [1700, 900], // green block
  ];
  const got = await samplePng(stage, [...inside, ...outside, ...painting]);
  const failures: string[] = [];
  inside.forEach((p, i) => {
    if (!near(got[i], litColour))
      failures.push(`lit ${p}: ${got[i]} != ${litColour}`);
  });
  outside.forEach((p, i) => {
    if (!near(got[inside.length + i], BASE)) {
      failures.push(`unlit ${p}: ${got[inside.length + i]} != ${BASE}`);
    }
  });
  const bar = got[inside.length + outside.length];
  const block = got[inside.length + outside.length + 1];
  if (!near(bar, [220, 180, 20])) failures.push(`bar: ${bar}`);
  if (!near(block, [40, 160, 80])) failures.push(`block: ${block}`);
  if (failures.length > 0)
    throw new Error(`mask overlay wrong: ${failures.join("; ")}`);
}

const errorCode = (page: Page) =>
  page.locator("#error").getAttribute("data-code");
const rowStatus = (page: Page, key: string) =>
  page
    .locator(`tr[data-key="${key}"] td[data-status]`)
    .getAttribute("data-status");
const pick = (page: Page, key: string) =>
  page.locator(`tr[data-key="${key}"]`).click();

async function natural(
  page: Page,
  selector: string,
): Promise<[number, number, number, number]> {
  return page.locator(selector).evaluate((el) => {
    const img = el as unknown as {
      naturalWidth: number;
      naturalHeight: number;
      complete: boolean;
    };
    const box = el.getBoundingClientRect();
    return [
      img.naturalWidth,
      img.naturalHeight,
      Math.round(box.width),
      Math.round(box.height),
    ];
  });
}

function sniff(path: string): string {
  const b = readFileSync(path);
  const info = readImageInfo(b);
  if (info !== null && b.subarray(8, 12).toString() === "WEBP") {
    return `webp ${info.width}x${info.height}`;
  }
  if (b.subarray(4, 8).toString() === "ftyp")
    return `m4a (${b.subarray(8, 12).toString()})`;
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WAVE"
  )
    return "wav";
  return "unknown";
}

function listening(pid: number, port: number): string[] {
  if (process.platform === "darwin") {
    const out = execFileSync(
      "lsof",
      ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
      { encoding: "utf8" },
    );
    return out
      .split("\n")
      .filter((l) => l.startsWith("n"))
      .map((l) => l.slice(1));
  }
  // Linux: /proc/net/tcp lists "local_address st" as hex, little-endian address.
  const found: string[] = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      const [addr, hexPort] = (cols[1] ?? "").split(":");
      if (cols[3] !== "0A" || addr === undefined || hexPort === undefined)
        continue;
      if (Number.parseInt(hexPort, 16) !== port) continue;
      if (addr.length === 8) {
        const bytes =
          addr
            .match(/../g)
            ?.reverse()
            .map((h) => Number.parseInt(h, 16)) ?? [];
        found.push(`${bytes.join(".")}:${port}`);
      } else found.push(`[${addr}]:${port}`);
    }
  }
  return found;
}

type Cli = {
  proc: ChildProcess;
  url: string;
  port: number;
  stderr: () => string;
};

function startCli(ws: Workspace, args: string[]): Promise<Cli> {
  const proc = spawn(
    process.execPath,
    ["--conditions=development", "--import", registerHooks, cliMain, ...args],
    {
      cwd: ws.root,
      env: { ...process.env, ...ws.env, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  let err = "";
  proc.stderr?.on("data", (d) => {
    err += d;
  });
  return new Promise((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error(`studio did not start: ${out} ${err}`)),
      30000,
    );
    proc.stdout?.on("data", (d) => {
      out += d;
      const m = /listening on (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(out);
      if (m !== null) {
        clearTimeout(timer);
        done({
          proc,
          url: m[1] as string,
          port: Number(m[2]),
          stderr: () => err,
        });
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      fail(
        new Error(`studio exited (${code}) before listening: ${out} ${err}`),
      );
    });
  });
}

describe("S7-01..07 the main flow, started by the CLI, at 1440x900", () => {
  let ws: Workspace;
  let cli: Cli;
  let page: Page;
  const requests: string[] = [];

  beforeAll(async () => {
    ws = buildWorkspace();
    cli = await startCli(ws, ["studio", "--port", "0"]);
    page = await newPage();
    page.on("request", (r) =>
      requests.push(`${r.method()} ${new URL(r.url()).pathname}`),
    );
  });
  afterAll(async () => {
    await page?.close();
    if (cli?.proc.exitCode === null) {
      const exited = new Promise<number | null>((done) =>
        cli.proc.once("exit", done),
      );
      cli.proc.kill("SIGTERM");
      evidence.cliExitCodeOnSigterm = await exited;
    }
    ws?.cleanup();
  });

  it("S7-01 the socket is bound to 127.0.0.1 only", () => {
    const addresses = listening(cli.proc.pid as number, cli.port);
    evidence.listeningSockets = addresses;
    evidence.url = cli.url;
    expect(addresses).toEqual([`127.0.0.1:${cli.port}`]);
    expect(cli.url).toBe(`http://127.0.0.1:${cli.port}/`);
  });

  it("S7-02 with no work folder it shows only the path form; saving and changing go through the config library", async () => {
    await page.goto(cli.url);
    await page.locator("#setup-form").waitFor();
    expect(
      await page.locator("#job-form, #needs, #filter-kind, #detail").count(),
    ).toBe(0);
    expect(await page.locator("body").innerText()).not.toContain(
      "painting.stair",
    );
    await shot(page, "01-setup.png");

    // Empty path: the library's own usage code. Nothing is saved.
    await page.locator("#setup-form-input").fill("");
    await page.locator("#setup-form-save").click();
    await expect.poll(() => errorCode(page)).toBe("AS-USAGE-1");
    expect(existsSync(join(ws.cfg, "settings.json"))).toBe(false);
    // A file is not a folder.
    await page.locator("#setup-form-input").fill(ws.jobPath);
    await page.locator("#setup-form-save").click();
    await expect.poll(() => errorCode(page)).toBe("AS-STUDIO-2");
    expect(await page.locator("#error").innerText()).toContain("AS-STUDIO-2:");
    expect(existsSync(join(ws.cfg, "settings.json"))).toBe(false);
    await shot(page, "02-setup-error.png");

    await page.locator("#setup-form-input").fill(ws.work);
    await page.locator("#setup-form-save").click();
    await page.locator("#job-form").waitFor();
    // The CLI library reads back what the page saved.
    expect(savedWorkFolder(ws.env)).toBe(ws.work);
    await page.reload();
    await page.locator("#job-form").waitFor();
    expect(await page.locator("#setup-form").count()).toBe(0);

    await page.locator("#nav-settings").click();
    await page.locator("#settings-form").waitFor();
    await shot(page, "03-settings.png");
    await page.locator("#settings-form-input").fill(ws.root);
    await page.locator("#settings-form-save").click();
    await page.locator("#saved-note").waitFor();
    expect(savedWorkFolder(ws.env)).toBe(ws.root);
    const kept = readFileSync(join(ws.cfg, "settings.json"), "utf8");
    // An invalid path later: its code is shown and the saved folder stays.
    await page.locator("#settings-form-input").fill(ws.jobPath);
    await page.locator("#settings-form-save").click();
    await expect.poll(() => errorCode(page)).toBe("AS-STUDIO-2");
    expect(readFileSync(join(ws.cfg, "settings.json"), "utf8")).toBe(kept);
    expect(savedWorkFolder(ws.env)).toBe(ws.root);
    await page.locator("#settings-form-input").fill(ws.work);
    await page.locator("#settings-form-save").click();
    await page.locator("#saved-note").waitFor();
    expect(savedWorkFolder(ws.env)).toBe(ws.work);
    // No job was rendered or requested while setup was incomplete or settings were open.
    expect(requests.filter((r) => r.includes("/api/review"))).toEqual([]);
  });

  it("S7-03 shows the needs list with all four statuses and filters it; an empty result is explicit", async () => {
    await page.locator("#nav-review").click();
    await page.locator("#job-form").waitFor();
    await page.locator("#job-input").fill(ws.jobPath);
    await page.locator("#job-open").click();
    await page.locator("#needs").waitFor();
    const keys = await page
      .locator("#needs tbody tr")
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-key")));
    expect(keys).toEqual([
      "portrait.narrator",
      "portrait.narrator~angry",
      "portrait.bystander",
      "portrait.bystander~scared",
      "scene-a.02~vo-01",
      "painting.stair",
      "glow.stair",
      "foe.shade~dashboard",
      "foe.shade~ipad",
      "sound.door",
    ]);
    const statuses = await page
      .locator("#needs td[data-status]")
      .evaluateAll((cells) =>
        [...new Set(cells.map((c) => c.getAttribute("data-status")))].sort(),
      );
    expect(statuses).toEqual(["draft", "final", "missing", "rejected"]);
    await shot(page, "04-needs.png");

    const visible = () =>
      page
        .locator("#needs tbody tr")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-key")));
    await page.locator("#filter-kind").selectOption("painting");
    expect(await visible()).toEqual(["painting.stair"]);
    await page.locator("#filter-kind").selectOption("");
    await page.locator("#filter-status").selectOption("final");
    expect(await visible()).toEqual([
      "foe.shade~dashboard",
      "foe.shade~ipad",
      "sound.door",
    ]);
    await page.locator("#filter-kind").selectOption("glow");
    await page.locator("#empty").waitFor();
    expect(await page.locator("#empty").innerText()).toBe(
      "No assets match these filters.",
    );
    expect(await page.locator("#needs").count()).toBe(0);
    await shot(page, "05-empty-filter.png");
    await page.locator("#filter-kind").selectOption("");
    await page.locator("#filter-status").selectOption("");
    expect((await visible()).length).toBe(10);
  });

  it("S7-03 looks at pictures at their profile sizes and a mood still at portrait size; the browser decodes them", async () => {
    const store = join(ws.work, "fixture-story", "store");
    const idx = readIndex(workPaths(ws.work, "fixture-story"));
    const decodedFormats: Record<string, string> = {};
    const cases: [string, [number, number]][] = [
      ["painting.stair", [1920, 1080]],
      ["foe.shade~dashboard", [1920, 1080]],
      ["foe.shade~ipad", [1640, 2360]],
      ["portrait.narrator~angry", [720, 900]],
    ];
    for (const [key, [w, h]] of cases) {
      await pick(page, key);
      await expect
        .poll(() => page.locator("#decoded").innerText())
        .toBe(`${w}×${h}`);
      const [nw, nh, bw, bh] = await natural(page, "#preview");
      expect([nw, nh]).toEqual([w, h]);
      expect([bw, bh]).toEqual([w, h]); // shown at its declared size
      const file = idx[key]?.file as string;
      decodedFormats[key] = sniff(join(store, file));
      expect(decodedFormats[key]).toBe(`webp ${w}x${h}`);
    }
    evidence.decodedPictures = decodedFormats;
    await shot(page, "06-mood-still.png");
  });

  it("S7-03 plays the m4a with its exact caption and the supplied sound", async () => {
    const store = join(ws.work, "fixture-story", "store");
    const idx = readIndex(workPaths(ws.work, "fixture-story"));
    await pick(page, "scene-a.02~vo-01");
    await expect
      .poll(() => page.locator("#decoded").innerText())
      .toMatch(/^audio, 1\.1\d s$/);
    expect(await page.locator("#caption").innerText()).toBe(
      "You come late. [pause 0.4] The others did not.",
    );
    await page.locator("#play").click();
    await expect
      .poll(() =>
        page
          .locator("#player")
          .evaluate(
            (el) => (el as unknown as { currentTime: number }).currentTime,
          ),
      )
      .toBeGreaterThan(0.05);
    await shot(page, "07-line-playing.png");
    await expect
      .poll(() => page.locator("#play-state").innerText())
      .toBe("ended");
    evidence.decodedLine = sniff(
      join(store, idx["scene-a.02~vo-01"]?.file as string),
    );
    expect(evidence.decodedLine).toBe("m4a (M4A )");

    await pick(page, "sound.door");
    await expect
      .poll(() => page.locator("#decoded").innerText())
      .toMatch(/^audio, 0\.2\d s$/);
    expect(await page.locator("#caption").count()).toBe(0);
    await page.locator("#play").click();
    await expect
      .poll(() => page.locator("#play-state").innerText())
      .toBe("ended");
    evidence.decodedSound = sniff(
      join(store, idx["sound.door"]?.file as string),
    );
  });

  it("S7-04 the grayscale mask overlays its painting at the known lit rectangle", async () => {
    await pick(page, "glow.stair");
    await page.locator("#stage").waitFor();
    await expect
      .poll(() => page.locator("#decoded").innerText())
      .toBe("1920×1080");
    expect((await natural(page, "#painting-img")).slice(0, 2)).toEqual([
      1920, 1080,
    ]);
    expect((await natural(page, "#mask-img")).slice(0, 2)).toEqual([
      1920, 1080,
    ]);
    // The decoded mask itself: gray (R=G=B), lit only inside the rectangle.
    const raw = await samplePage(page, "#mask-img", [
      [LIT.x + 10, LIT.y + 10],
      [LIT.x - 10, LIT.y + 10],
      [10, 10],
    ]);
    expect(raw).toEqual([
      [200, 200, 200, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const stage = await page.locator("#stage").screenshot();
    writeFileSync(join(evidenceDir, "08-mask-overlay-stage.png"), stage);
    // The element sits at a fractional offset, so the capture may round up by a pixel;
    // every sampled point is 5+ px from an edge, so that cannot move a result.
    expect(readImageInfo(stage)?.width).toBe(1920);
    expect([1080, 1081]).toContain(readImageInfo(stage)?.height);
    await assertMaskOverlay(stage, LIT);
    await shot(page, "08-mask-overlay.png");
    // Without the mask the lit spot is the painting again.
    await page.locator("#mask-toggle").uncheck();
    const plain = await page.locator("#stage").screenshot();
    const [spot] = await samplePng(plain, [
      [LIT.x + LIT.w / 2, LIT.y + LIT.h / 2],
    ]);
    expect(near(spot, BASE)).toBe(true);
    await page.locator("#mask-toggle").check();
    evidence.maskPixels = {
      lit: litColour,
      painting: BASE,
      litRect: LIT,
      maskGray: MASK_GRAY,
    };
  });

  it("S7-05/06 approve, reject, double click, a stale review and a reload, with nothing else changed", async () => {
    const story = join(ws.work, "fixture-story");
    const paths = workPaths(ws.work, "fixture-story");
    const treeBefore = {
      job: sha256(readFileSync(ws.jobPath)),
      masters: hashTree(join(story, "masters")),
      store: hashTree(join(story, "store")),
      other: hashTree(join(ws.work, "other-story")),
    };
    const idxBefore = readIndex(paths);

    // Approve a draft line.
    await pick(page, "scene-a.02~vo-01");
    await page.locator("#approve").click();
    await expect.poll(() => rowStatus(page, "scene-a.02~vo-01")).toBe("final");
    expect(readIndex(paths)["scene-a.02~vo-01"]?.status).toBe("final");

    // A double click is one write.
    const approvals: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/approve")) approvals.push(r.url());
    });
    await pick(page, "portrait.narrator~angry");
    await page.locator("#approve").dblclick();
    await expect
      .poll(() => rowStatus(page, "portrait.narrator~angry"))
      .toBe("final");
    expect(approvals.length).toBe(1);

    // Reject a separate draft with the fixture's exact note.
    const note = "too dark, lighter dawn";
    await pick(page, "painting.stair");
    await page.locator("#reject-note").fill(note);
    await page.locator("#reject").click();
    await expect.poll(() => rowStatus(page, "painting.stair")).toBe("rejected");
    expect(readIndex(paths)["painting.stair"]?.status).toBe("rejected");
    expect(readIndex(paths)["painting.stair"]?.notes).toEqual([note]);
    expect(readNotes(paths)["painting.stair"]).toEqual([note]);
    await shot(page, "09-after-decisions.png");

    // Negative: a draft is re-rendered while the review is open.
    await pick(page, "glow.stair");
    await page.locator("#stage").waitFor();
    const opened = readIndex(paths)["glow.stair"]?.file as string;
    const idx = JSON.parse(readFileSync(ws.indexPath, "utf8"));
    const replacement = ws.put("glow-stair-shifted.webp", "webp");
    idx["glow.stair"].file = replacement;
    idx["glow.stair"].inputsHash = `sha256:${sha256("re-rendered")}`;
    writeFileSync(ws.indexPath, JSON.stringify(idx, null, 2));
    await page.locator("#approve").click();
    await expect.poll(() => errorCode(page)).toBe("AS-STUDIO-6");
    await shot(page, "10-stale-error.png");
    expect(readIndex(paths)["glow.stair"]?.status).toBe("draft");
    expect(readIndex(paths)["glow.stair"]?.file).toBe(replacement);
    expect(replacement).not.toBe(opened);
    // The page refreshed to the new bytes; approving them is a fresh decision.
    await expect
      .poll(() => page.locator("#d-file").innerText())
      .toBe(replacement);
    await page.locator("#approve").click();
    await expect.poll(() => rowStatus(page, "glow.stair")).toBe("final");
    expect(await page.locator("#error").getAttribute("hidden")).not.toBeNull();

    // Reload: everything persisted; the filter finds the rejected work.
    await page.reload();
    await page.locator("#needs").waitFor();
    expect(await rowStatus(page, "scene-a.02~vo-01")).toBe("final");
    expect(await rowStatus(page, "painting.stair")).toBe("rejected");
    await page.locator("#filter-status").selectOption("rejected");
    const rejected = await page
      .locator("#needs tbody tr")
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-key")));
    expect(rejected).toEqual(["portrait.narrator", "painting.stair"]);
    await shot(page, "11-reloaded-rejected.png");

    // Preservation: only the three decisions (and the simulated re-render) changed anything.
    const idxAfter = readIndex(paths);
    const changedKeys = Object.keys(idxAfter).filter(
      (k) => JSON.stringify(idxAfter[k]) !== JSON.stringify(idxBefore[k]),
    );
    expect(changedKeys.sort()).toEqual([
      "glow.stair",
      "painting.stair",
      "portrait.narrator~angry",
      "scene-a.02~vo-01",
    ]);
    const storeAfter = hashTree(join(story, "store"));
    for (const [file, hash] of Object.entries(treeBefore.store)) {
      expect(storeAfter[file]).toBe(hash);
    }
    const hashes = {
      job: sha256(readFileSync(ws.jobPath)),
      masters: hashTree(join(story, "masters")),
      store: storeAfter,
      other: hashTree(join(ws.work, "other-story")),
    };
    expect(hashes.job).toBe(treeBefore.job);
    expect(hashes.masters).toEqual(treeBefore.masters);
    expect(hashes.other).toEqual(treeBefore.other);
    evidence.preservation = {
      job: hashes.job,
      masters: hashes.masters,
      otherStory: hashes.other,
      storeFilesBefore: Object.keys(treeBefore.store).length,
      storeFilesAfter: Object.keys(storeAfter).length,
      note: "store gained only the simulated re-render file; every earlier store file has the same hash",
    };
    expect(pageErrors).toEqual([]);
    expect(cli.stderr()).toContain("AS-STUDIO-6"); // the stale conflict was logged
  });
});

/** Read pixels of an <img> as the browser decoded it. */
async function samplePage(
  page: Page,
  selector: string,
  points: [number, number][],
) {
  return page.locator(selector).evaluate((el, pts) => {
    const img = el as unknown as {
      naturalWidth: number;
      naturalHeight: number;
    };
    const g = globalThis as unknown as {
      OffscreenCanvas: new (
        w: number,
        h: number,
      ) => {
        getContext(t: string): {
          drawImage(i: unknown, x: number, y: number): void;
          getImageData(
            x: number,
            y: number,
            w: number,
            h: number,
          ): { data: Uint8ClampedArray };
        };
      };
    };
    const ctx = new g.OffscreenCanvas(
      img.naturalWidth,
      img.naturalHeight,
    ).getContext("2d");
    ctx.drawImage(img, 0, 0);
    return pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  }, points);
}

describe("S7-04/06 failure cases at 1440x900", () => {
  let ws: Workspace;
  let studio: StudioServer;
  let page: Page;

  const open = async () => {
    studio = await startStudio({
      env: ws.env,
      cwd: ws.root,
      workFolder: ws.work,
      job: ws.jobPath,
      stderr: () => {},
    });
    page = await newPage();
    await page.goto(studio.url);
    await page.locator("#needs").waitFor();
  };
  const paths = () => workPaths(ws.work, "fixture-story");

  const closeAll = async () => {
    await page?.close();
    await studio?.close();
    ws?.cleanup();
  };

  it("a wrong mask (lit rectangle in the wrong place) fails the pixel check", async () => {
    ws = buildWorkspace();
    try {
      const idx = JSON.parse(readFileSync(ws.indexPath, "utf8"));
      idx["glow.stair"].file = ws.put("glow-stair-shifted.webp", "webp");
      writeFileSync(ws.indexPath, JSON.stringify(idx, null, 2));
      await open();
      await pick(page, "glow.stair");
      await expect
        .poll(() => page.locator("#decoded").innerText())
        .toBe("1920×1080");
      const stage = await page.locator("#stage").screenshot();
      await expect(assertMaskOverlay(stage, LIT)).rejects.toThrow(
        /mask overlay wrong/,
      );
    } finally {
      await closeAll();
    }
  });

  it("a corrupt store file shows AS-STORE-1, cannot be approved, and the index is untouched", async () => {
    ws = buildWorkspace();
    try {
      const file = readIndex(paths())["painting.stair"]?.file as string;
      writeFileSync(join(ws.storeDir, file), "not the bytes the name promises");
      const before = readFileSync(ws.indexPath, "utf8");
      await open();
      await pick(page, "painting.stair");
      await expect.poll(() => errorCode(page)).toBe("AS-STORE-1");
      expect(await page.locator("#approve").isDisabled()).toBe(true);
      await shot(page, "12-corrupt-media.png");
      expect(readFileSync(ws.indexPath, "utf8")).toBe(before);
    } finally {
      await closeAll();
    }
  });

  it("media the browser cannot decode (JSON named .m4a) shows AS-STUDIO-5 and cannot be approved", async () => {
    ws = buildWorkspace();
    try {
      const file = ws.put(Buffer.from('{"not":"audio"}'), "m4a");
      const idx = JSON.parse(readFileSync(ws.indexPath, "utf8"));
      idx["scene-a.02~vo-01"].file = file;
      writeFileSync(ws.indexPath, JSON.stringify(idx, null, 2));
      await open();
      await pick(page, "scene-a.02~vo-01");
      await expect.poll(() => errorCode(page)).toBe("AS-STUDIO-5");
      expect(await page.locator("#approve").isDisabled()).toBe(true);
      expect(readIndex(paths())["scene-a.02~vo-01"]?.status).toBe("draft");
    } finally {
      await closeAll();
    }
  });

  it("a picture the job no longer lists fails AS-ID-1 on approve; nothing becomes final", async () => {
    ws = buildWorkspace();
    try {
      await open();
      await pick(page, "scene-a.02~vo-01");
      const job = JSON.parse(readFileSync(ws.jobPath, "utf8"));
      job.lines = [];
      writeFileSync(ws.jobPath, JSON.stringify(job));
      const before = readFileSync(ws.indexPath, "utf8");
      await page.locator("#approve").click();
      await expect.poll(() => errorCode(page)).toBe("AS-ID-1");
      expect(readFileSync(ws.indexPath, "utf8")).toBe(before);
      expect(readIndex(paths())["scene-a.02~vo-01"]?.status).toBe("draft");
    } finally {
      await closeAll();
    }
  });

  it("an induced save failure shows its code and the draft stays a draft", async () => {
    ws = buildWorkspace();
    try {
      await open();
      await pick(page, "painting.stair");
      const before = readFileSync(ws.indexPath, "utf8");
      // A regular file where the story lock folder must be made.
      writeFileSync(join(ws.work, "fixture-story", ".lock"), "stuck");
      await page.locator("#approve").click();
      await expect
        .poll(() => errorCode(page), { timeout: 20000 })
        .toBe("AS-STORE-4");
      await shot(page, "13-save-failure.png");
      expect(readFileSync(ws.indexPath, "utf8")).toBe(before);
      expect(await rowStatus(page, "painting.stair")).toBe("draft");
    } finally {
      await closeAll();
    }
  }, 40000);

  it("an unknown job file shows the library's code", async () => {
    ws = buildWorkspace();
    try {
      await open();
      await page.locator("#job-input").fill(join(ws.root, "missing-job.json"));
      await page.locator("#job-open").click();
      await expect.poll(() => errorCode(page)).toBe("AS-JOB-1");
      expect(MEDIA.length).toBeGreaterThan(0);
    } finally {
      await closeAll();
    }
  });
});

describe("S7-02 which work folder the CLI-started studio uses", () => {
  let a: Workspace;
  let b: Workspace;
  let cli: Cli | undefined;
  let page: Page | undefined;

  const stop = async () => {
    await page?.close();
    if (cli?.proc.exitCode === null) {
      const exited = new Promise((done) => cli?.proc.once("exit", done));
      cli.proc.kill("SIGTERM");
      await exited;
    }
    a.cleanup();
    b.cleanup();
  };
  const status = (ws: Workspace, key: string) =>
    readIndex(workPaths(ws.work, "fixture-story"))[key]?.status;

  it("with a saved folder A and no flag, changing to B in Settings makes review and approve use B", async () => {
    a = buildWorkspace();
    b = buildWorkspace();
    try {
      setWorkFolder(a.env, a.work, a.root);
      cli = await startCli(a, ["studio", "--port", "0"]);
      page = await newPage();
      await page.goto(`${cli.url}?job=${encodeURIComponent(a.jobPath)}`);
      await page.locator("#needs").waitFor();
      expect(await page.locator("#pinned-note").count()).toBe(0);
      await page.locator("#nav-settings").click();
      await page.locator("#settings-form-input").fill(b.work);
      await page.locator("#settings-form-save").click();
      await page.locator("#saved-note").waitFor();
      expect(savedWorkFolder(a.env)).toBe(b.work);
      await page.locator("#nav-review").click();
      await page.locator("#needs").waitFor();
      // Make B recognisable: its painting is already final there.
      const idx = JSON.parse(readFileSync(b.indexPath, "utf8"));
      idx["painting.stair"].status = "final";
      writeFileSync(b.indexPath, JSON.stringify(idx, null, 2));
      await page.locator("#job-open").click();
      await expect
        .poll(() => rowStatus(page as Page, "painting.stair"))
        .toBe("final");
      await pick(page, "scene-a.02~vo-01");
      await page.locator("#approve").click();
      await expect
        .poll(() => rowStatus(page as Page, "scene-a.02~vo-01"))
        .toBe("final");
      expect(status(b, "scene-a.02~vo-01")).toBe("final");
      expect(status(a, "scene-a.02~vo-01")).toBe("draft");
      await pick(page, "portrait.narrator~angry");
      await page.locator("#reject-note").fill("redo it");
      await page.locator("#reject").click();
      await expect
        .poll(() => rowStatus(page as Page, "portrait.narrator~angry"))
        .toBe("rejected");
      expect(status(b, "portrait.narrator~angry")).toBe("rejected");
      expect(status(a, "portrait.narrator~angry")).toBe("draft");
    } finally {
      await stop();
    }
  });

  it("a real --work-folder pins the run, the page says so, and Settings still saves for later", async () => {
    a = buildWorkspace();
    b = buildWorkspace();
    try {
      setWorkFolder(a.env, a.work, a.root);
      cli = await startCli(a, [
        "--work-folder",
        b.work,
        "studio",
        "--port",
        "0",
      ]);
      page = await newPage();
      await page.goto(`${cli.url}?job=${encodeURIComponent(a.jobPath)}`);
      await page.locator("#needs").waitFor();
      expect(await page.locator("#pinned-note").innerText()).toContain(b.work);
      await pick(page, "scene-a.02~vo-01");
      await page.locator("#approve").click();
      await expect
        .poll(() => rowStatus(page as Page, "scene-a.02~vo-01"))
        .toBe("final");
      expect(status(b, "scene-a.02~vo-01")).toBe("final");
      expect(status(a, "scene-a.02~vo-01")).toBe("draft");
      await page.locator("#nav-settings").click();
      expect(await page.locator("#flag-note").innerText()).toContain(
        "--work-folder",
      );
      expect(savedWorkFolder(a.env)).toBe(a.work);
    } finally {
      await stop();
    }
  });
});
