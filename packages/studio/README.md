# @asset-studio/studio

The local review studio: look at drafts, listen to lines, approve or reject. It listens on 127.0.0.1 only and changes the work folder only through `@asset-studio/cli`'s library.

Start it with `asset-studio studio [--job <asset-job.json>] [--port <n>]` (install this package next to the CLI).

Browser tests (`pnpm test`) use Playwright's Chromium: `pnpm exec playwright install chromium` once. Set `STUDIO_EVIDENCE_DIR` to keep the 1440x900 screenshots and `evidence.json`.
