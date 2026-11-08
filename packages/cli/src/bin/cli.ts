import { resolve } from "node:path";

import { CliError, EXIT_FAILURE, EXIT_USAGE } from "../config/errors.js";
import {
  type Env,
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

export type CliContext = {
  env: Env;
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export const USAGE = `Usage: asset-studio [--work-folder <path>] <command>

Commands:
  config get workFolder            Show the saved work folder
  config set workFolder <path>     Save the work folder for this user
  needs <job> [--json]             List every asset ID the job needs, with status
  approve <job> <id>               Mark an asset final
  reject <job> <id> --note <text>  Mark an asset rejected and keep the note

Exit codes: 0 ok, 1 failure, 2 usage, 3 work folder not set (AS-CONFIG-1).
`;

const COMMANDS = new Set(["config", "needs", "approve", "reject"]);

type Parsed = {
  positionals: string[];
  json: boolean;
  help: boolean;
  workFolder: string | undefined;
  note: string | undefined;
};

const usageError = (message: string) =>
  new CliError("AS-USAGE-1", message, EXIT_USAGE, [USAGE.trimEnd()]);

function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = {
    positionals: [],
    json: false,
    help: false,
    workFolder: undefined,
    note: undefined,
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

function run(argv: readonly string[], ctx: CliContext): void {
  const parsed = parseArgs(argv);
  const [command, ...args] = parsed.positionals;
  if (parsed.help || command === undefined) {
    if (!parsed.help) throw usageError("Missing command.");
    ctx.stdout(USAGE);
    return;
  }
  if (!COMMANDS.has(command)) throw usageError(`Unknown command "${command}".`);
  if (command === "config") {
    runConfig(args, parsed, ctx);
    return;
  }

  // Every other command needs the work folder before anything else.
  const workFolder = resolveWorkFolder(ctx.env, ctx.cwd, parsed.workFolder);

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
export function main(argv: readonly string[], ctx: CliContext): number {
  try {
    run(argv, ctx);
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
