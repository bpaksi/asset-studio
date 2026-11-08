import { dirname, resolve } from "node:path";

import { type Command, registerCommand, usageError } from "../bin/registry.js";
import { CliError, EXIT_FAILURE } from "../config/errors.js";
import { loadJob } from "../needs/needs.js";
import { workPaths } from "../store/store.js";
import {
  type Renderer,
  type RenderKind,
  registeredRenderers,
} from "./registry.js";

const KINDS: readonly RenderKind[] = ["voice", "picture"];

export const renderCommand: Command = {
  name: "render",
  usage: "render <job> [--only voice|picture] [--ai]",
  summary: "Make draft voices and pictures for the job",
  options: { "--only": { value: true }, "--ai": { value: false } },
  async run(ctx, args) {
    const [jobPath, ...extra] = args.positionals;
    if (jobPath === undefined || extra.length > 0) {
      throw usageError(
        "Use: render <asset-job.json> [--only voice|picture] [--ai].",
      );
    }
    const only = args.options["--only"];
    if (only !== undefined && !KINDS.includes(only as RenderKind)) {
      throw usageError(
        `--only must be voice or picture, not "${String(only)}".`,
      );
    }
    const ai = args.options["--ai"] === true;
    const wanted = only === undefined ? KINDS : [only as RenderKind];

    const all = registeredRenderers();
    if (all.length === 0) {
      throw new CliError(
        "AS-RENDER-0",
        "render is not built yet.",
        EXIT_FAILURE,
      );
    }
    // Source renderers first; AI renderers then fill what is still missing.
    const selected = all
      .filter((r) => wanted.includes(r.kind) && (ai || r.ai !== true))
      .sort((a, b) => Number(a.ai === true) - Number(b.ai === true));
    if (selected.length === 0) {
      const missing = wanted.map((k) => `${k}`).join(" and ");
      throw new CliError(
        "AS-RENDER-3",
        `No ${missing} renderer is registered.`,
        EXIT_FAILURE,
      );
    }
    if (ai && !all.some((r) => r.ai === true)) {
      throw new CliError(
        "AS-RENDER-3",
        "No AI renderer is registered, so --ai cannot run.",
        EXIT_FAILURE,
      );
    }

    const absJobPath = resolve(ctx.cwd, jobPath);
    const where = { jobPath: absJobPath, jobDir: dirname(absJobPath) };
    const job = loadJob(absJobPath);
    const paths = workPaths(ctx.workFolder, job.story);
    let rendered = 0;
    let failed = 0;
    const runOne = async (renderer: Renderer) => {
      try {
        const outcome = await renderer.render(ctx, job, paths, where);
        rendered += outcome?.rendered ?? 0;
        failed += outcome?.failed ?? 0;
      } catch (error) {
        failed += 1;
        if (error instanceof CliError) {
          ctx.stderr(`${error.code}: ${error.message}\n`);
          for (const line of error.extraLines) ctx.stderr(`${line}\n`);
        } else {
          const text = error instanceof Error ? error.message : String(error);
          ctx.stderr(
            `AS-RENDER-1: ${renderer.ai === true ? "AI " : ""}${renderer.kind} renderer failed: ${text}\n`,
          );
        }
      }
    };
    for (const renderer of selected) await runOne(renderer);

    ctx.stdout(`rendered ${rendered}, failed ${failed}\n`);
    if (failed > 0) {
      throw new CliError("AS-RENDER-2", `${failed} failed.`, EXIT_FAILURE);
    }
  },
};

registerCommand(renderCommand);
