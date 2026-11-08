import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { CliError, configNotSet, EXIT_FAILURE, EXIT_USAGE } from "./errors.js";

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The per-user settings file. macOS: `~/Library/Application Support/
 * asset-studio/settings.json`. `ASSET_STUDIO_CONFIG_DIR` replaces the folder
 * (used by tests and by anyone who wants settings elsewhere).
 */
export function settingsPath(
  env: Env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.ASSET_STUDIO_CONFIG_DIR;
  if (override !== undefined && override !== "") {
    return join(resolve(override), "settings.json");
  }
  // Empty or relative values count as unset (XDG spec; also guards APPDATA).
  const absoluteOr = (value: string | undefined, fallback: string): string =>
    value !== undefined && isAbsolute(value) ? value : fallback;
  const home = absoluteOr(env.HOME, homedir());
  if (platform === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "asset-studio",
      "settings.json",
    );
  }
  if (platform === "win32") {
    const base = absoluteOr(env.APPDATA, join(home, "AppData", "Roaming"));
    return join(base, "asset-studio", "settings.json");
  }
  const base = absoluteOr(env.XDG_CONFIG_HOME, join(home, ".config"));
  return join(base, "asset-studio", "settings.json");
}

export type Settings = { workFolder?: string } & Record<string, unknown>;

const badSettings = (message: string) =>
  new CliError("AS-CONFIG-2", message, EXIT_FAILURE);

export function readSettings(path: string): Settings {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw badSettings(
      `Cannot read settings ${path}: ${(error as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badSettings(`Settings file ${path} is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badSettings(`Settings file ${path} must hold a JSON object.`);
  }
  const settings = parsed as Settings;
  if (
    settings.workFolder !== undefined &&
    typeof settings.workFolder !== "string"
  ) {
    throw badSettings(`Settings file ${path}: workFolder must be a string.`);
  }
  return settings;
}

export function writeSettings(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(tmp, path);
}

/** The saved work folder, or undefined while none is set. */
export function savedWorkFolder(env: Env): string | undefined {
  const value = readSettings(settingsPath(env)).workFolder;
  return value === undefined || value === "" ? undefined : value;
}

export function setWorkFolder(env: Env, folder: string, cwd: string): string {
  if (folder.trim() === "") {
    throw new CliError("AS-USAGE-1", "workFolder needs a path.", EXIT_USAGE);
  }
  const absolute = resolve(cwd, folder);
  const path = settingsPath(env);
  writeSettings(path, { ...readSettings(path), workFolder: absolute });
  return absolute;
}

/**
 * The work folder for this run: the `--work-folder` flag when given, else the
 * saved setting. Fails with AS-CONFIG-1 when neither is set.
 */
export function resolveWorkFolder(
  env: Env,
  cwd: string,
  flag: string | undefined,
): string {
  if (flag !== undefined) {
    if (flag.trim() === "") {
      throw new CliError(
        "AS-USAGE-1",
        "--work-folder needs a path.",
        EXIT_USAGE,
      );
    }
    return resolve(cwd, flag);
  }
  const saved = savedWorkFolder(env);
  if (saved === undefined) throw configNotSet();
  return saved;
}
