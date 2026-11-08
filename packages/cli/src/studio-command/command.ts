import { type Command, registerCommand, usageError } from "../bin/registry.js";
import { CliError, EXIT_FAILURE } from "../config/errors.js";

// Placeholder: S7 replaces the failure with a call to @asset-studio/studio.
export const studioCommand: Command = {
  name: "studio",
  usage: "studio",
  summary: "Open the review studio in the browser",
  options: {},
  run(_ctx, args) {
    if (args.positionals.length > 0) {
      throw usageError("studio takes no arguments.");
    }
    throw new CliError("AS-STUDIO-0", "studio is not built yet.", EXIT_FAILURE);
  },
};

registerCommand(studioCommand);
