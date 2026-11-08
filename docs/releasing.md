# Releasing

`@asset-studio/formats` and `@asset-studio/player` publish to npm. `@asset-studio/cli` stays private.

0.1.0 was published by hand. Later versions use npm trusted publishing (GitHub Actions OIDC, workflow `release.yml`, no environment, no `NPM_TOKEN`).

## One-time npm setup

On npmjs.com, for each of `@asset-studio/formats` and `@asset-studio/player`, add a Trusted Publisher (Settings → Trusted Publisher → GitHub Actions):

- Organization or user: `bpaksi`
- Repository: `asset-studio`
- Workflow filename: `release.yml` (filename only, including `.yml`; not a path)
- Environment: leave blank (no environment)
- Allowed actions: check **Allow `npm publish`**. Trusted publisher configurations created after 2026-09-03 default to `npm stage publish` only; direct `npm publish` is opt-in. This repo's Release workflow runs `npm publish`, so a new config that leaves that box unchecked will reject the first OIDC run. See [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/).

After the first OIDC publish succeeds, npm recommends Settings → Publishing access → **Require two-factor authentication and disallow tokens**. Do that only after that first run works (trusted publishers keep working under that setting; traditional tokens do not).

## Each release

1. Bump `version` in `packages/formats/package.json` and `packages/player/package.json` to the same semver (do not publish from `workspace:*` — the release job packs first so pnpm rewrites that to the real formats version).
2. Merge to `main`.
3. Run the **Release** workflow (`Actions` → `release` → `Run workflow` on `main`). Versions already on npm are skipped, so a rerun after a partial publish is a no-op for those packages.

The first OIDC publish is untested until that run succeeds.
