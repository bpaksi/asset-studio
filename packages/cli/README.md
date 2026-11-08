# @asset-studio/cli

The `asset-studio` command: the build pipeline for a story's voices, pictures and glow masks. MIT license.

```sh
npm install --save-dev @asset-studio/cli
npx asset-studio config set workFolder ./work
npx asset-studio needs asset-job.json
npx asset-studio render asset-job.json
npx asset-studio approve asset-job.json <asset-id>
npx asset-studio export asset-job.json --out ./exported
```

The job file follows the [job contract](https://github.com/bpaksi/asset-studio/blob/main/docs/job-contract.md). Voice rendering with Gemini TTS needs `GEMINI_API_KEY`. For the review studio, install `@asset-studio/studio` next to this package and run `asset-studio studio`.

The package also exports a library (the work folder, store and `needs` helpers) that `@asset-studio/studio` uses. Node 22 or later; `sharp` is a dependency.

## Fake providers (CI and install checks)

Set `ASSET_STUDIO_FAKE_PROVIDERS=1` to render with no API key, no network and no macOS `afconvert`:

- voice lines get a short deterministic tone whose length tracks the text, and a small stub m4a;
- `render --ai` pictures, stills and masks are deterministic images and greyscale masks at the requested size.

Every such run prints `AS-FAKE-1: fake providers in use (ASSET_STUDIO_FAKE_PROVIDERS=1); output is not real media` on stderr. The output is draft-quality placeholder media: do not approve or ship it. Only the exact value `1` turns it on; unset or anything else leaves real providers in place.

Fake runs keep a ledger, `<work-folder>/<story>/fake.json`, of every asset they stored. A fake run refuses with `AS-FAKE-2` if the story already holds an asset that is not in the ledger, so use a separate `--work-folder` for fake runs. A normal run drops the ledger's assets first and renders them for real (`AS-FAKE-4` says how many). `approve` on a ledger asset works but warns `AS-FAKE-3`.
