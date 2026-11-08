/** A CLI failure with a stable code, a message for stderr and an exit code. */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly extraLines: readonly string[];

  constructor(
    code: string,
    message: string,
    exitCode = 1,
    extraLines: readonly string[] = [],
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.extraLines = extraLines;
  }
}

export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_CONFIG = 3;

export const CONFIG_HELP_LINE =
  "Set the work folder: asset-studio config set workFolder <path>";

export const configNotSet = (): CliError =>
  new CliError("AS-CONFIG-1", "The work folder is not set.", EXIT_CONFIG, [
    CONFIG_HELP_LINE,
  ]);
