# Changelog

## 0.2.1

First release of all four packages together: `@asset-studio/formats`, `@asset-studio/player`, `@asset-studio/cli` and `@asset-studio/studio`, all at `0.2.1`, published by the release workflow with provenance. `@asset-studio/cli` and `@asset-studio/studio` are public from this version. Formats and player 0.2.0 were published by hand and stay on npm. Player is unchanged in 0.2.1. Formats adds the job contract schemas (`jobSchema`, `derivedIds`, the index, notes and camera-edit schemas), additively; nothing existing changes.

### For consumers (P2 S2 to S8)

- **Job contract v1** (`@asset-studio/formats`): one `asset-job.json` per story with cast, lines, pictures, moments and sounds, `jobSchema`, `derivedIds` (every asset the job implies, with built ids such as `portrait.<speaker>`), the export index schema, notes and camera-edit schemas. See `docs/job-contract.md` and `docs/export-contract.md`.
- **CLI** (`@asset-studio/cli`, bin `asset-studio`): `config`, `needs`, `render`, `approve`, `reject`, `export` and `studio`. Work happens in a work folder you choose (`config set workFolder <path>` or `--work-folder`): a content-addressed store, an `index.json` with a status per asset id (`missing`, `draft`, `final`, `rejected`) and `notes.json` for "redo" notes. The store is safe against two processes at once.
- **Voice**: lines are rendered through a TTS provider (Gemini first) into a WAV master and an m4a draft, with pause markers such as `[pause 0.4]`. Needs `GEMINI_API_KEY`, and macOS `afconvert` for the m4a. Failed lines are logged with their id and an `AS-VOICE-*` code.
- **Pictures and glow masks**: a source image is kept as a master and sized per profile into WebP; glow masks are checked and sized to match their picture; mood stills are built from cast portraits.
- **AI mode** (`render --ai`): fills missing pictures, mood stills and glow masks as drafts through an image provider (Gemini first). It never makes a final, never regenerates a final asset, and remakes a rejected asset only when it has a redo note. Errors log `AS-AI-*` with the id and the run continues.
- **Studio review** (`@asset-studio/studio`): a local web page on 127.0.0.1 to look, listen, approve and reject. It changes the work folder only through the CLI library. Start it with `asset-studio studio` (install both packages).
- **Export**: `export <job> --out <folder>` copies final assets (drafts with `--drafts`) under content-hashed names with an `export-index.json` carrying each asset's kind, size and status.
- Install: `npm install --save-dev @asset-studio/cli` (add `@asset-studio/studio` for the review page). Node 22 or later. Try it on `examples/lantern-tale/asset-job.json`.

### For Bob: first publish of cli and studio

npm trusted publishers can only be added to a package that exists, and cli and studio are not on npm yet. Do this once, in order:

1. Merge the release-prep PR. On an up-to-date `main`, with an npm login that can publish to `@asset-studio`:
   ```sh
   pnpm install --frozen-lockfile
   ```
2. Set the two packages to a throwaway version, without committing it, and hand-publish them:
   ```sh
   for p in cli studio; do (cd packages/$p && npm version 0.2.1-bootstrap.0 --no-git-tag-version); done
   pnpm --filter ./packages/cli pack --pack-destination /tmp/boot
   pnpm --filter ./packages/studio pack --pack-destination /tmp/boot
   npm publish /tmp/boot/asset-studio-cli-0.2.1-bootstrap.0.tgz --access public --tag bootstrap
   npm publish /tmp/boot/asset-studio-studio-0.2.1-bootstrap.0.tgz --access public --tag bootstrap
   git checkout packages/cli/package.json packages/studio/package.json
   ```
   `pnpm pack` rewrites `workspace:*` to the versions in the tree, so the studio bootstrap tarball depends on `@asset-studio/cli@0.2.1-bootstrap.0`. Nobody should install these two. The `bootstrap` tag only keeps this version off `latest` until the 0.2.1 release moves `latest`.
3. On npmjs.com add a Trusted Publisher to `@asset-studio/cli` and `@asset-studio/studio` (user `bpaksi`, repository `asset-studio`, workflow `release.yml`, no environment, allow `npm publish`). Formats and player already have theirs.
4. Run the **release** workflow on `main`. It refuses to run if any of the four `0.2.1` versions is already on npm, then publishes formats, player, cli, studio with provenance.
5. Optionally `npm deprecate '@asset-studio/cli@0.2.1-bootstrap.0' 'bootstrap only'` (same for studio).

See `docs/releasing.md`.

## 0.2.0 — released (formats and player, by hand)

### Renamed to asset-studio

- The packages are now `@asset-studio/formats`, `@asset-studio/player` and `@asset-studio/cli`. Exports, schemas and behaviour are the same as 0.1.0. The asset contract keeps its name and its v2 number.
- The repo moved from `bpaksi/talking-avatar` to [`bpaksi/asset-studio`](https://github.com/bpaksi/asset-studio). GitHub redirects the old URL.
- Migrating: replace `@talking-avatar/` with `@asset-studio/` in `package.json` and imports, and pin `0.2.0`. Nothing else changes.

### For Bob: deprecate the old names

Run once `@asset-studio/formats@0.2.0` and `@asset-studio/player@0.2.0` are on npm (needs an npm login with publish rights on `@talking-avatar`):

```sh
npm deprecate '@talking-avatar/formats@*' "Renamed to @asset-studio/formats. Install @asset-studio/formats@0.2.0 or later; the API is unchanged."
npm deprecate '@talking-avatar/player@*' "Renamed to @asset-studio/player. Install @asset-studio/player@0.2.0 or later; the API is unchanged."
```

Check with `npm view @talking-avatar/formats deprecated` and `npm view @talking-avatar/player deprecated`.

## 0.1.0

### Contract v2: WebP portrait and mouths

- `portrait` and `mouths/*` may be `.webp` or `.png` (WebP preferred for shipped art; it keeps transparency for overlay mode). PNG masters stay in git-ignored `masters/`.
- `@talking-avatar/formats`: `validateAvatar` size and alpha checks accept WebP; new `readWebpInfo` and `readImageInfo` (PNG or WebP); `mouthFileName(shape, extension = "webp")`.
- `@talking-avatar/player`: no loader change; paths are used as given, so `.webp` works.

First release of `@talking-avatar/formats` and `@talking-avatar/player`, for the first consumer (Bloodtower). Follows [asset contract v2](docs/asset-contract.md). `@talking-avatar/cli` is not published yet (`"private": true`).

### Docs

- Camera-track contract v1 **draft** ([issue #7](https://github.com/bpaksi/talking-avatar/issues/7)): optional pan/zoom over a still (`docs/camera-track-contract.md`, JSON Schema, examples). Additive; asset contract v1 stays locked. Not implemented in formats or player. Awaits Bob's approval.
- Camera-track contract v1 **locked** (2026-11-07): moment clock, closed `ease` set, fixed `letterbox-hold-push` prelude, reduced-motion cuts, objects inline on the consumer's moment (no sidecar, no `id` field), shape rules in formats and file rules in the host loader. Built in P2 S9 inside `<Painting>`.

### @talking-avatar/formats

- Zod schemas and types for a character folder: `avatarManifestSchema` (`manifest.json`, with optional `mouthMode`, default `"frame"`), `anchorSchema` (`anchor.json`), and `rhubarbJsonSchema` (Rhubarb timing, now also checking cue order and overlap).
- `validateAvatar(dir)` from `@talking-avatar/formats/node` checks contract rules 1–10 and returns every problem with its rule, file and `line_id`.
- Rhubarb `H` maps to `CONS/EE` when the kit has no `L` (was `EH/AE`), as in the contract.

### @talking-avatar/player

- `<TalkingAvatar manifest lineId baseUrl onEnd />`: plays a line's `.m4a`, samples `audio.currentTime` every animation frame and shows the mouth for the cue at that time (`frame` mode). Captions show the line text without `[pause N]` markup. All mouth frames and timing files load up front. If the browser blocks autoplay, a "Tap to play" button starts the audio.
- `letterAt` and `createMouthClock`, the cue lookup and frame loop behind the component.
- `react` is a peer dependency (`^18.0.0 || ^19.0.0`).
