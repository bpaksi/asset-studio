# Changelog

## 0.2.0 — unreleased

### Renamed to asset-studio

- The packages are now `@asset-studio/formats`, `@asset-studio/player` and `@asset-studio/cli` (still private). Exports, schemas and behaviour are the same as 0.1.0. The asset contract keeps its name and its v2 number.
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

### @talking-avatar/formats

- Zod schemas and types for a character folder: `avatarManifestSchema` (`manifest.json`, with optional `mouthMode`, default `"frame"`), `anchorSchema` (`anchor.json`), and `rhubarbJsonSchema` (Rhubarb timing, now also checking cue order and overlap).
- `validateAvatar(dir)` from `@talking-avatar/formats/node` checks contract rules 1–10 and returns every problem with its rule, file and `line_id`.
- Rhubarb `H` maps to `CONS/EE` when the kit has no `L` (was `EH/AE`), as in the contract.

### @talking-avatar/player

- `<TalkingAvatar manifest lineId baseUrl onEnd />`: plays a line's `.m4a`, samples `audio.currentTime` every animation frame and shows the mouth for the cue at that time (`frame` mode). Captions show the line text without `[pause N]` markup. All mouth frames and timing files load up front. If the browser blocks autoplay, a "Tap to play" button starts the audio.
- `letterAt` and `createMouthClock`, the cue lookup and frame loop behind the component.
- `react` is a peer dependency (`^18.0.0 || ^19.0.0`).
