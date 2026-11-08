import { type Command, registerCommand, usageError } from "../bin/registry.js";
import { CliError, EXIT_FAILURE } from "../config/errors.js";

/** What the CLI uses of `@asset-studio/studio` (loaded on demand, not a declared dependency). */
type StudioModule = {
  runStudio(options: {
    env: Readonly<Record<string, string | undefined>>;
    cwd: string;
    workFolder: string | undefined;
    job: string | undefined;
    port: number;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  }): Promise<void>;
};

const STUDIO_PACKAGE = "@asset-studio/studio";

async function loadStudio(): Promise<StudioModule> {
  try {
    // A variable specifier keeps cli from declaring or type-checking against studio.
    return (await import(STUDIO_PACKAGE)) as StudioModule;
  } catch (error) {
    const missing =
      (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" &&
      (error as Error).message.includes(STUDIO_PACKAGE);
    throw new CliError(
      "AS-STUDIO-1",
      missing
        ? `${STUDIO_PACKAGE} is not installed next to the CLI.`
        : `${STUDIO_PACKAGE} could not be loaded: ${(error as Error).message}`,
      EXIT_FAILURE,
      missing ? [`Install it: npm install ${STUDIO_PACKAGE}`] : [],
    );
  }
}

export const studioCommand: Command = {
  name: "studio",
  usage: "studio [--job <path>] [--port <n>]",
  summary: "Review drafts in the browser (127.0.0.1 only)",
  options: { "--job": { value: true }, "--port": { value: true } },
  needsWorkFolder: false,
  async run(ctx, args) {
    if (args.positionals.length > 0) {
      throw usageError("studio takes no arguments.");
    }
    const portText = args.options["--port"];
    let port = 0;
    if (portText !== undefined) {
      port = typeof portText === "string" ? Number(portText) : Number.NaN;
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw usageError("--port needs a number from 0 to 65535.");
      }
    }
    const job = args.options["--job"];
    const studio = await loadStudio();
    await studio.runStudio({
      env: ctx.env,
      cwd: ctx.cwd,
      workFolder: ctx.workFolder,
      job: typeof job === "string" ? job : undefined,
      port,
      stdout: ctx.stdout,
      stderr: ctx.stderr,
    });
  },
};

registerCommand(studioCommand);
