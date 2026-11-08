import { isAbsolute, join } from "node:path";

import type { Job } from "@asset-studio/formats";

import type { CommandContext } from "../bin/registry.js";
import type { WorkPaths } from "../store/store.js";

/**
 * Where the job file is (both absolute), and whether `render` was given
 * `--ai`. A source renderer reads `ai` to leave what AI mode will fill (for
 * example a missing hand-placed glow mask) instead of failing it.
 */
export type RenderJob = { jobPath: string; jobDir: string; ai: boolean };

/**
 * Resolve a path written in the job (`art/x.png`, `ref/y.webp`, `sfx/z.wav`)
 * against the folder that holds `asset-job.json`. Absolute paths stay as they are.
 */
export const resolveJobPath = (jobDir: string, p: string): string =>
  isAbsolute(p) ? p : join(jobDir, p);

export type RenderKind = "voice" | "picture";

/** What a renderer reports. A renderer logs each failed asset itself (id and code). */
export type RenderOutcome = { rendered: number; failed: number };

/**
 * A renderer for one kind of asset. S4 (voice), S5 (pictures) and S6 (AI mode)
 * register theirs from their own folder with `registerRenderer`, and `bin/commands.ts`
 * imports that folder; `render/command.ts` is not edited.
 *
 * - The 4th argument says where the job file is. Resolve every relative path
 *   in the job with `resolveJobPath(where.jobDir, p)`, never from `ctx.cwd`.
 *   A renderer that declares fewer parameters still compiles.
 * - `ai: true` renderers run only when `render --ai` is given; the others
 *   always run for their kind.
 * - `render` may return its counts. If it throws, `render` logs the error as
 *   `AS-RENDER-1` and counts one failure; the next renderer still runs.
 */
export type Renderer = {
  kind: RenderKind;
  ai?: boolean;
  render(
    ctx: CommandContext,
    job: Job,
    paths: WorkPaths,
    where: RenderJob,
  ): Promise<RenderOutcome | undefined> | RenderOutcome | undefined;
};

const renderers: Renderer[] = [];

export function registerRenderer(renderer: Renderer): void {
  renderers.push(renderer);
}

export const registeredRenderers = (): readonly Renderer[] => renderers;

/** For tests: remove the renderers that were registered. */
export function clearRenderers(): void {
  renderers.length = 0;
}
