import { resolve } from "node:path";

import { CliError, EXIT_FAILURE } from "../config/errors.js";
import {
  resolveWorkFolder,
  savedWorkFolder,
  setWorkFolder,
} from "../config/settings.js";
import {
  approve,
  computeNeeds,
  formatNeeds,
  loadJob,
  reject,
} from "../needs/needs.js";
import { workPaths } from "../store/store.js";
import "./commands.js";
import {
  type CliContext,
  getCommand,
  usageError,
  usageText,
} from "./registry.js";

export type { CliContext } from "./registry.js";

const COMMANDS = new Set(["config", "needs", "approve", "reject"]);

type Parsed = {
  positionals: string[];
  json: boolean;
  help: boolean;
  workFolder: string | undefined;
  note: string | undefined;
  options: Record<string, string | true>;
};

/** The first positional, found without parsing flags (a registered command's flags decide the rest). */
function findCommand(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--work-folder" || arg === "--note") i++;
    else if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

function parseArgs(
  argv: readonly string[],
  own: Readonly<Record<string, { value: boolean }>>,
): Parsed {
  const parsed: Parsed = {
    positionals: [],
    json: false,
    help: false,
    workFolder: undefined,
    note: undefined,
    options: {},
  };
  const value = (flag: string, index: number, inline: string | undefined) => {
    if (inline !== undefined) return { text: inline, next: index };
    const next = argv[index + 1];
    if (next === undefined) throw usageError(`${flag} needs a value.`);
    return { text: next, next: index + 1 };
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (name === "--json" && inline === undefined) parsed.json = true;
    else if (name === "--help" || name === "-h") parsed.help = true;
    else if (name === "--work-folder" || name === "--note") {
      const { text, next } = value(name, i, inline);
      i = next;
      if (name === "--note") parsed.note = text;
      else parsed.workFolder = text;
    } else if (Object.hasOwn(own, name) && own[name]?.value) {
      const { text, next } = value(name, i, inline);
      i = next;
      parsed.options[name] = text;
    } else if (Object.hasOwn(own, name)) {
      if (inline !== undefined) throw usageError(`${name} takes no value.`);
      parsed.options[name] = true;
    } else if (arg.startsWith("--") && arg.length > 2) {
      throw usageError(`Unknown option ${name}.`);
    } else parsed.positionals.push(arg);
  }
  return parsed;
}

function runConfig(args: string[], parsed: Parsed, ctx: CliContext): void {
  const [action, key, value, ...extra] = args;
  if ((action !== "get" && action !== "set") || key === undefined) {
    throw usageError(
      "Use: config get workFolder, or config set workFolder <path>.",
    );
  }
  if (key !== "workFolder") {
    throw usageError(
      `Unknown setting "${key}". The only setting is workFolder.`,
    );
  }
  if (parsed.json || parsed.note !== undefined || extra.length > 0) {
    throw usageError("Too many arguments for config.");
  }
  if (action === "get") {
    if (value !== undefined) throw usageError("config get takes no value.");
    const saved = savedWorkFolder(ctx.env);
    if (saved === undefined) {
      throw new CliError(
        "AS-CONFIG-3",
        "workFolder is not set.",
        EXIT_FAILURE,
        ["Set the work folder: asset-studio config set workFolder <path>"],
      );
    }
    ctx.stdout(`${saved}\n`);
    return;
  }
  if (value === undefined)
    throw usageError("config set workFolder needs a path.");
  ctx.stdout(`${setWorkFolder(ctx.env, value, ctx.cwd)}\n`);
}

async function run(argv: readonly string[], ctx: CliContext): Promise<void> {
  const name = findCommand(argv);
  const registered = name === undefined ? undefined : getCommand(name);
  const parsed = parseArgs(argv, registered?.options ?? {});
  const [command, ...args] = parsed.positionals;
  if (parsed.help || command === undefined) {
    if (!parsed.help) throw usageError("Missing command.");
    ctx.stdout(usageText());
    return;
  }
  if (!COMMANDS.has(command) && registered === undefined) {
    throw usageError(`Unknown command "${command}".`);
  }
  if (command === "config") {
    runConfig(args, parsed, ctx);
    return;
  }

  if (registered !== undefined && registered.needsWorkFolder === false) {
    if (parsed.json || parsed.note !== undefined) {
      throw usageError(`${registered.name} takes no --json or --note.`);
    }
    let workFolder: string | undefined;
    try {
      workFolder = resolveWorkFolder(ctx.env, ctx.cwd, parsed.workFolder);
    } catch (error) {
      // Only "not set" is expected here; the command shows its own form.
      if (!(error instanceof CliError && error.code === "AS-CONFIG-1")) {
        throw error;
      }
    }
    await registered.run(
      { ...ctx, workFolder },
      { positionals: args, options: parsed.options },
    );
    return;
  }

  // Every other command needs the work folder before anything else.
  const workFolder = resolveWorkFolder(ctx.env, ctx.cwd, parsed.workFolder);

  if (registered !== undefined) {
    if (parsed.json || parsed.note !== undefined) {
      throw usageError(`${registered.name} takes no --json or --note.`);
    }
    await registered.run(
      { ...ctx, workFolder },
      { positionals: args, options: parsed.options },
    );
    return;
  }

  if (command === "needs") {
    const [jobPath, ...extra] = args;
    if (
      jobPath === undefined ||
      extra.length > 0 ||
      parsed.note !== undefined
    ) {
      throw usageError("Use: needs <asset-job.json> [--json].");
    }
    const job = loadJob(resolve(ctx.cwd, jobPath));
    const needs = computeNeeds(job, workPaths(workFolder, job.story));
    ctx.stdout(
      parsed.json ? `${JSON.stringify(needs, null, 2)}\n` : formatNeeds(needs),
    );
    return;
  }

  const [jobPath, id, ...extra] = args;
  if (
    jobPath === undefined ||
    id === undefined ||
    extra.length > 0 ||
    parsed.json
  ) {
    throw usageError(
      command === "approve"
        ? "Use: approve <asset-job.json> <id>."
        : 'Use: reject <asset-job.json> <id> --note "<text>".',
    );
  }
  if (command === "approve") {
    if (parsed.note !== undefined) throw usageError("approve takes no --note.");
    const job = loadJob(resolve(ctx.cwd, jobPath));
    approve(job, workPaths(workFolder, job.story), id);
    ctx.stdout(`${id}: final\n`);
    return;
  }
  if (parsed.note === undefined)
    throw usageError("reject needs --note <text>.");
  const job = loadJob(resolve(ctx.cwd, jobPath));
  reject(job, workPaths(workFolder, job.story), id, parsed.note);
  ctx.stdout(`${id}: rejected\n`);
}

/** Run the CLI and return its exit code. Never throws. */
export async function main(
  argv: readonly string[],
  ctx: CliContext,
): Promise<number> {
  try {
    await run(argv, ctx);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      ctx.stderr(`${error.code}: ${error.message}\n`);
      for (const line of error.extraLines) ctx.stderr(`${line}\n`);
      return error.exitCode;
    }
    ctx.stderr(`AS-INTERNAL-1: ${(error as Error).message}\n`);
    return EXIT_FAILURE;
  }
}
