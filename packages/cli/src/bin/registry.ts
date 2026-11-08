import { CliError, EXIT_USAGE } from "../config/errors.js";
import type { Env } from "../config/settings.js";

export type CliContext = {
  env: Env;
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

/** What a registered command gets: the CLI context and the resolved work folder. */
export type CommandContext = CliContext & { workFolder: string };

/** Positionals and the command's own flags (`true` for a flag with no value). */
export type CommandArgs = {
  positionals: string[];
  options: Readonly<Record<string, string | true>>;
};

/**
 * A command module exports one of these and registers it with
 * `registerCommand`. `bin/commands.ts` imports every command module; adding a
 * command is one import line there. The dispatcher resolves the work folder
 * first (AS-CONFIG-1 when unset), so `run` only parses and validates its own
 * flags. `options` lists the command's flags: `{ value: true }` takes a value
 * (`--only voice`), `{ value: false }` is a switch (`--ai`).
 */
export type Command = {
  name: string;
  /** The usage text, for example `render <job> [--only voice|picture] [--ai]`. */
  usage: string;
  /** One line shown after the usage in `--help`. */
  summary: string;
  options: Readonly<Record<string, { value: boolean }>>;
  run(ctx: CommandContext, args: CommandArgs): void | Promise<void>;
};

const BUILT_IN = ["config", "needs", "approve", "reject"];
const commands = new Map<string, Command>();

export function registerCommand(command: Command): void {
  if (BUILT_IN.includes(command.name) || commands.has(command.name)) {
    throw new Error(`Command "${command.name}" is already registered.`);
  }
  commands.set(command.name, command);
}

export const getCommand = (name: string): Command | undefined =>
  commands.get(name);

const HEAD = `Usage: asset-studio [--work-folder <path>] <command>

Commands:
  config get workFolder            Show the saved work folder
  config set workFolder <path>     Save the work folder for this user
  needs <job> [--json]             List every asset ID the job needs, with status
  approve <job> <id>               Mark an asset final
  reject <job> <id> --note <text>  Mark an asset rejected and keep the note
`;

const TAIL =
  "\nExit codes: 0 ok, 1 failure, 2 usage, 3 work folder not set (AS-CONFIG-1).\n";

/** The full usage text, including every registered command. */
export function usageText(): string {
  const lines = [...commands.values()].map((c) =>
    c.usage.length < 32
      ? `  ${c.usage.padEnd(32)} ${c.summary}\n`
      : `  ${c.usage}\n  ${"".padEnd(32)} ${c.summary}\n`,
  );
  return `${HEAD}${lines.join("")}${TAIL}`;
}

export const usageError = (message: string): CliError =>
  new CliError("AS-USAGE-1", message, EXIT_USAGE, [usageText().trimEnd()]);
