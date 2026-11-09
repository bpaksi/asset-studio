# Releasing

All four packages publish to npm at one version: `@asset-studio/formats`, `@asset-studio/player`, `@asset-studio/cli` and `@asset-studio/studio`.

0.1.0 and the 0.2.0 of formats and player were published by hand. From 0.2.1 the `release.yml` workflow publishes all four with npm trusted publishing (GitHub Actions OIDC, no environment, no `NPM_TOKEN`) and provenance.

## One-time npm setup

On npmjs.com, for each of the four packages, add a Trusted Publisher (Settings, Trusted Publisher, GitHub Actions):

- Organization or user: `bpaksi`
- Repository: `asset-studio`
- Workflow filename: `release.yml` (filename only, including `.yml`; not a path)
- Environment: leave blank (no environment)
- Allowed actions: check **Allow `npm publish`**. Trusted publisher configurations created after 2026-09-03 default to `npm stage publish` only; direct `npm publish` is opt-in. This repo's Release workflow runs `npm publish`, so a new config that leaves that box unchecked will reject the first OIDC run. See [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/).

If the workflow's publish PUT fails with an npm `E404`, that package's trusted publisher does not match. Check the user, the repository name (without the owner), the `release.yml` filename only, a blank environment, and that **Allow `npm publish`** is ticked.

Formats and player have theirs. A package must exist on npm before it can have a trusted publisher, so `@asset-studio/cli` and `@asset-studio/studio` need a one-time hand publish of a throwaway version first:

1. On `main` after `pnpm install --frozen-lockfile`, set both to `0.2.1-bootstrap.0` without committing: `(cd packages/cli && npm version 0.2.1-bootstrap.0 --no-git-tag-version)`, and the same in `packages/studio`.
2. `pnpm --filter ./packages/cli pack --pack-destination /tmp/boot`, the same for studio, then `npm publish <tarball> --access public --tag bootstrap` for each (npm sets `latest` to the bootstrap version on a first publish whatever `--tag` says, so `latest` and `bootstrap` both point at it; the first real release moves `latest`).
3. `git checkout packages/cli/package.json packages/studio/package.json`.
4. Add the Trusted Publishers above to both packages.

After the first OIDC publish succeeds, npm recommends Settings, Publishing access, **Require two-factor authentication and disallow tokens**. Do that only after that first run works (trusted publishers keep working under that setting; traditional tokens do not).

## Each release

1. Bump `version` in all four `packages/*/package.json` to the same semver. The workspace links (`workspace:*`) are rewritten to that version when the job packs.
2. Add the section to `CHANGELOG.md`. Merge to `main`.
3. Run the **Release** workflow (Actions, release, Run workflow, on `main`).

The workflow stops before publishing anything if the four versions differ or if any of the four is already on npm, so a re-run of an already-published version stops early. Only an npm E404 counts as "not published"; any other error stops the run. It then installs Chromium for the studio tests, runs `pnpm check` and `node scripts/smoke-pack.mjs`, packs all four, and publishes formats, player, cli, studio in that order. If a publish fails part-way, some packages are already on npm: bump all four to the next patch and run again; do not republish by hand.

Follow-up, not done: run the workflow in a GitHub environment with required reviewers (and add it to each Trusted Publisher) so a publish needs a second approval.

## Smoke test

`node scripts/smoke-pack.mjs` packs the four packages, installs the tarballs into a fresh temp project with `npm install`, and runs the installed `asset-studio` bin (`needs`, `render`, `approve`, `export`) on `examples/lantern-tale/asset-job.json`. It runs as the `smoke-pack` job in CI and in the release job. A second case runs `render` and `render --ai` with `ASSET_STUDIO_FAKE_PROVIDERS=1` and no key on `examples/lantern-tale-fake` (a voiced line, an AI-made picture and portrait) in its own work folder, then approves and exports.
