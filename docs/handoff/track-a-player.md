# Handoff: Track A — formats + player slice, first npm release

> Historical: written for the 0.1.0 release under the old name. The packages are now `@asset-studio/formats` and `@asset-studio/player` (from 0.2.0), and the repo is `bpaksi/asset-studio`. See [CHANGELOG.md](../../CHANGELOG.md).

For Claude Code, run by Bob. Repo: `bpaksi/talking-avatar`, default branch `main`. Package manager: pnpm. Contract: [docs/asset-contract.md](../asset-contract.md).

Goal: ship `@talking-avatar/formats` and `@talking-avatar/player` 0.1.0 early so Bloodtower can install them from npm. `@talking-avatar/cli` is not part of this release.

## Step 1: S2 formats types + validator

- Runs: cloud
- Touches: `packages/formats/**`, `packages/formats/fixtures/keeper/**`
- Work:
  - Zod schemas + TS types for `manifest.json` (including optional `mouthMode`, default `"frame"`), `anchor.json`, Rhubarb JSON, per the contract.
  - `validateAvatar(dir)` (Node) applying contract rules 1–10; returns a list of errors with file and `line_id`.
  - Fixture set: a `keeper` folder in contract layout with `mouthMode: "frame"`, built from small generated placeholder images and audio. No real Bloodtower art, audio or script (P1: consumer assets never live in this repo). Add negative fixtures: missing letter, missing file, duplicate `line_id`, anchor out of range, bad cue letter, overlapping cues, a mouth image of the wrong size for its `mouthMode`, an unknown `mouthMode`, empty `captionTheme`, missing `text`, `id` not equal to the folder name, an absolute path.
- Acceptance:
  - `pnpm check` green.
  - Keeper fixture validates with zero errors.
  - Each negative fixture fails with the expected rule and names the file.

## Step 2: thin S5 player

- Runs: cloud
- Touches: `packages/player/**`
- Work: `<TalkingAvatar manifest={...} lineId="ts-keeper-001" onEnd={() => {}} />`
  - Plays the line's `.m4a` in an `<audio>` element.
  - Per frame (requestAnimationFrame), samples `audio.currentTime`, binary-searches the latest cue at or before it, shows that letter's mouth. `REST` before the first cue and once audio has ended. While audio still plays past the last cue, hold that cue's value until its `end`, then `REST`.
  - `mouthMode: "frame"` (the slice): each mouth file is a full portrait, so the player swaps the whole image in the portrait's box and it scales with the portrait. `overlay` (mouth drawn into the anchor box, fractions → % positioning) can wait until a kit needs it.
  - Preloads all mouth images; no network calls during playback beyond the audio.
  - Basic caption: line `text` with `[pause N]` stripped. Themes later (`captionTheme` ignored for now).
  - Calls `onEnd` when audio ends.
  - Resolves paths relative to a base URL (prop `baseUrl`, e.g. `/avatars/keeper/`).
- Acceptance:
  - Unit tests for cue lookup (start, between cues, seek, past the last cue's `end` while audio remains, after audio has ended).
  - Example page plays the Keeper fixture with synced mouths in desktop Safari and iPad Safari (audio starts from a user tap).
  - `pnpm check` green.

## Step 3: package prep for 0.1.0

- Runs: cloud
- Touches: `packages/formats/package.json`, `packages/player/package.json`, `packages/cli/package.json`, `.github/workflows/release.yml`, `CHANGELOG.md`, `README.md`
- Work: set `version` to `0.1.0` in both; confirm `files`, `exports`, `types`, `publishConfig.access: "public"`, `LICENSE` copy; `react` as a peer dependency of the player. Set `"private": true` on `@talking-avatar/cli` so `pnpm -r publish` skips it (a `0.0.0` version alone does not stop a publish). The existing `release.yml` runs on every `v*` tag, uses `NPM_TOKEN`, and checks the cli version too, so switch its trigger to `workflow_dispatch` only until step 6 replaces it. The step 4 tag then starts nothing.
- Acceptance: `pnpm -r --filter "./packages/formats" --filter "./packages/player" pack` produces tarballs containing `dist` and `LICENSE`; `pnpm check` green; PR merged to `main`.

## Step 4: first publish by hand

- Runs: local (Bob's Mac; needs 2FA)
- Work:

```sh
git checkout main && git pull
pnpm install --frozen-lockfile
pnpm check && pnpm -r run build
npm login                       # npm org: talking-avatar, 2FA prompt
cd packages/formats && pnpm publish --access public
cd ../player && pnpm publish --access public
git tag v0.1.0 && git push origin v0.1.0
```

- Acceptance: `npm view @talking-avatar/formats@0.1.0` and `npm view @talking-avatar/player@0.1.0` resolve; a scratch project can `pnpm add @talking-avatar/player@0.1.0`.
- Note: the tag push must not trigger a second publish. Step 3 turned off the tag trigger in `release.yml`; check that no workflow run starts for `v0.1.0`.

## Step 5: npm trusted publishing

- Runs: local (npmjs.com, Bob)
- Work: on npmjs.com, for each of `@talking-avatar/formats` and `@talking-avatar/player`: Settings → Trusted publisher → GitHub Actions, repository `bpaksi/talking-avatar`, workflow `release.yml`. Then set publishing access to require 2FA and disallow tokens.
- Acceptance: both packages show the trusted publisher. No `NPM_TOKEN` secret exists in the repo.

## Step 6: release workflow (OIDC, provenance)

- Runs: cloud
- Touches: `.github/workflows/release.yml`, `scripts/check-versions.mjs` (new)
- Outline:

```yaml
name: release
on:
  push:
    tags: ["v[0-9]*"]
permissions:
  contents: read
  id-token: write          # OIDC for trusted publishing + provenance
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check tag is semver
        run: '[[ "$GITHUB_REF_NAME" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]]'
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.4 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: "https://registry.npmjs.org" }
      - run: npm install -g npm@latest   # trusted publishing needs npm >= 11.5
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm -r run build
      - name: Versions match tag
        run: node scripts/check-versions.mjs "${GITHUB_REF_NAME#v}"
      - run: pnpm -r --filter "./packages/*" publish --provenance --access public --no-git-checks
```

  No `NPM_TOKEN` / `NODE_AUTH_TOKEN`. `pnpm -r publish` skips private packages, and `check-versions.mjs` checks only the non-private `packages/*` against the tag. Before relying on it, confirm that the pinned pnpm publishes through npm's OIDC flow. If it does not, publish each package with `npm publish --provenance` instead.
- Acceptance: a `v0.1.1` (or prerelease) tag publishes via OIDC with a provenance badge on npm; a non-semver tag fails the check step.

P1 S7 and *Distribution* already describe this flow (manual 0.1.0, then trusted publishing).
