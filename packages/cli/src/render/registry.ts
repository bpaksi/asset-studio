import type { Job } from "@asset-studio/formats";

import type { CommandContext } from "../bin/registry.js";
import type { WorkPaths } from "../store/store.js";

export type RenderKind = "voice" | "picture";

/** What a renderer reports. A renderer logs each failed asset itself (id and code). */
export type RenderOutcome = { rendered: number; failed: number };

/**
 * A renderer for one kind of asset. S4 (voice), S5 (pictures) and S6 (AI mode)
 * register theirs from their own folder with `registerRenderer`, and `bin/commands.ts`
 * imports that folder; `render/command.ts` is not edited.
 *
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
