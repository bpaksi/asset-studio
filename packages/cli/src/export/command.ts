import { resolve } from "node:path";

import { type Command, registerCommand, usageError } from "../bin/registry.js";
import { loadJob } from "../needs/needs.js";
import { workPaths } from "../store/store.js";
import { exportJob } from "./export.js";

export const exportCommand: Command = {
  name: "export",
  usage: "export <job> --out <folder> [--drafts]",
  summary: "Copy final assets (and drafts with --drafts) into a folder",
  options: { "--out": { value: true }, "--drafts": { value: false } },
  run(ctx, args) {
    const [jobPath, ...extra] = args.positionals;
    const out = args.options["--out"];
    if (
      jobPath === undefined ||
      extra.length > 0 ||
      typeof out !== "string" ||
      out === ""
    ) {
      throw usageError(
        "Use: export <asset-job.json> --out <folder> [--drafts].",
      );
    }
    const absJob = resolve(ctx.cwd, jobPath);
    const job = loadJob(absJob);
    const paths = workPaths(ctx.workFolder, job.story);
    const result = exportJob(job, paths, absJob, resolve(ctx.cwd, out), {
      drafts: args.options["--drafts"] === true,
    });
    ctx.stdout(`exported ${result.exported} assets to ${result.out}\n`);
  },
};

registerCommand(exportCommand);
