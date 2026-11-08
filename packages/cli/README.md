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
