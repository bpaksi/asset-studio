# @asset-studio/cli

Command-line build pipeline for asset-studio. The scaffold re-exports the pause-aware TTS request builder. MIT license.

## Fake providers (CI and install checks)

Set `ASSET_STUDIO_FAKE_PROVIDERS=1` to render with no API key, no network and no macOS `afconvert`:

- voice lines get a short deterministic tone whose length tracks the text, and a small stub m4a;
- `render --ai` pictures, stills and masks are deterministic images and greyscale masks at the requested size.

Every such run prints `AS-FAKE-1: fake providers in use (ASSET_STUDIO_FAKE_PROVIDERS=1); output is not real media` on stderr. The output is draft-quality placeholder media: do not approve or ship it. Only the exact value `1` turns it on; unset or anything else leaves real providers in place.

Fake runs keep a ledger, `<work-folder>/<story>/fake.json`, of every asset they stored. A fake run refuses with `AS-FAKE-2` if the story already holds an asset that is not in the ledger, so use a separate `--work-folder` for fake runs. A normal run drops the ledger's assets first and renders them for real (`AS-FAKE-4` says how many). `approve` on a ledger asset works but warns `AS-FAKE-3`.
