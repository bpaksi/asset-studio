import { type Command, registerCommand, usageError } from "../bin/registry.js";
import { CliError, EXIT_FAILURE } from "../config/errors.js";

// Placeholder: S8 replaces the failure with the real export, in this folder.
export const exportCommand: Command = {
  name: "export",
  usage: "export <job> --out <folder> [--drafts]",
  summary: "Copy final assets (and drafts with --drafts) into a folder",
  options: { "--out": { value: true }, "--drafts": { value: false } },
  run(_ctx, args) {
    const [jobPath, ...extra] = args.positionals;
    const out = args.options["--out"];
    if (jobPath === undefined || extra.length > 0 || out === undefined) {
      throw usageError(
        "Use: export <asset-job.json> --out <folder> [--drafts].",
      );
    }
    throw new CliError("AS-EXPORT-0", "export is not built yet.", EXIT_FAILURE);
  },
};

registerCommand(exportCommand);
