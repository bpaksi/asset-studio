import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveWorkFolder,
  savedWorkFolder,
  settingsPath,
  setWorkFolder,
} from "./settings.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "as-config-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("settingsPath", () => {
  it("uses Application Support on macOS", () => {
    expect(settingsPath({ HOME: "/Users/x" }, "darwin")).toBe(
      "/Users/x/Library/Application Support/asset-studio/settings.json",
    );
  });
  it("uses XDG on linux and APPDATA on windows", () => {
    expect(settingsPath({ HOME: "/h", XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(
      "/xdg/asset-studio/settings.json",
    );
    expect(settingsPath({ HOME: "/h" }, "linux")).toBe(
      "/h/.config/asset-studio/settings.json",
    );
    expect(settingsPath({ HOME: "C:/h", APPDATA: "C:/a" }, "win32")).toContain(
      "asset-studio",
    );
  });
  it("honours ASSET_STUDIO_CONFIG_DIR", () => {
    expect(settingsPath({ ASSET_STUDIO_CONFIG_DIR: dir })).toBe(
      join(dir, "settings.json"),
    );
  });
});

describe("work folder setting", () => {
  const env = () => ({ ASSET_STUDIO_CONFIG_DIR: join(dir, "cfg") });

  it("is unset at first, then saved as an absolute path", () => {
    expect(savedWorkFolder(env())).toBeUndefined();
    const saved = setWorkFolder(env(), "work", dir);
    expect(saved).toBe(resolve(dir, "work"));
    expect(savedWorkFolder(env())).toBe(saved);
  });

  it("keeps other settings keys when setting", () => {
    const path = settingsPath(env());
    setWorkFolder(env(), "a", dir);
    writeFileSync(path, JSON.stringify({ workFolder: "/a", other: 1 }));
    setWorkFolder(env(), "b", dir);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      workFolder: resolve(dir, "b"),
      other: 1,
    });
  });

  it("fails AS-CONFIG-1 when unset, and the flag overrides without saving", () => {
    expect(() => resolveWorkFolder(env(), dir, undefined)).toThrow(
      /work folder is not set/,
    );
    expect(resolveWorkFolder(env(), dir, "over")).toBe(resolve(dir, "over"));
    expect(savedWorkFolder(env())).toBeUndefined();
  });

  it("rejects an empty path and corrupt settings", () => {
    expect(() => setWorkFolder(env(), " ", dir)).toThrow(/needs a path/);
    writeFileSync(join(dir, "settings.json"), "{nope");
    expect(() => savedWorkFolder({ ASSET_STUDIO_CONFIG_DIR: dir })).toThrow(
      /not valid JSON/,
    );
  });
});
