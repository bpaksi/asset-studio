# asset-studio

A story-neutral CLI and local web studio that turn a job (a cast, lines, pictures, moments and sounds) into finished media files: voice, pictures, glow masks, AI-drafted art, camera moves for paintings, and talking avatars. The CLI does the work headless, so an agent can drive it. The studio is for looking, listening and approving drafts. Talking avatars (`line.json` played live with `<TalkingAvatar>`) are one part of it.

This repo was `talking-avatar`. From 0.2.0 the packages are published under `@asset-studio`; `@talking-avatar/*` 0.1.0 is deprecated. See [plans/P2-asset-studio.md](plans/P2-asset-studio.md) for the road to 0.2 and 0.3.

Status: 0.2.0 of [`@asset-studio/formats`](packages/formats/README.md) (schemas and the character folder validator) and [`@asset-studio/player`](packages/player/README.md) (`<TalkingAvatar>`), built on [asset contract v2](docs/asset-contract.md). The API is the same as `@talking-avatar/*` 0.1.0. `@asset-studio/cli` is not published yet. See `docs/sdlc.md`, `docs/lip-sync-best-practices.md`, `plans/` and [CHANGELOG.md](CHANGELOG.md).

```sh
pnpm add @asset-studio/formats@0.2.0 @asset-studio/player@0.2.0
```

Package manager: pnpm. `pnpm check` runs lint, typecheck, and tests. To release: bump `formats` and `player` to the same version, merge to `main`, and run the Release workflow. See [docs/releasing.md](docs/releasing.md). License: MIT.
