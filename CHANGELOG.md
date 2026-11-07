# Changelog

## 0.1.0 — unreleased

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
