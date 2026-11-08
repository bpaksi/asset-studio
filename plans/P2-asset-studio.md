# P2 plan: talking-avatar becomes asset-studio

Status: **revised 2026-11-07 and approved by Bob (G0b passed), 2026-11-07**. Bob approved the first version on 2026-10-28 (G0). This revision brings P2 in line with the Bloodtower rulings made since then: DEC-578, DEC-622, DEC-623, DEC-576, DEC-719, and DEC-839 to DEC-844 from the 2026-11-07 session (Bloodtower AREA-122). It also builds Bloodtower 1.0's path first. No code yet: no step starts until Bob says so.

## Goal

This repo grows from talking avatars into **asset-studio**: a story-neutral CLI and a local web studio that turn a job (a cast, lines, pictures, moments and sounds) into finished media files. Talking avatars are one part of it. Voice, pictures, glow masks, AI art, Painting camera moves and draft-to-final review are the rest.

The consumer is Bloodtower (`bpaksi/bloodtower`). Its rulings are its game-design cards: DEC-382 to DEC-403 (session 2026-10-28), DEC-578, DEC-622, DEC-623 (2026-10-29), and DEC-839 to DEC-844 (2026-11-07). This plan repeats what the code needs from them, so it can be read without the cards. Bloodtower's side (pack to job, its lint, packaging into a pack, the `bt-assets` skill) is Bloodtower plan A1, not this repo. *Consumer follow-ups* below lists what A1 must change to match.

## Two releases

| Release | For | Holds |
|---|---|---|
| **0.2** | Bloodtower 1.0 (its art run, C5-05: the Loremaster's voice, AI-drafted pictures, studio approval; no talking Portrait) | Rename, job contract, CLI with work folder and store, voice, pictures and glow masks, AI pictures and glow masks, studio review, export |
| **0.3** | Bloodtower 1.1 | Asset contract v3 (chin line), talking avatars, AI mouth edits, the `<Painting>` player and the studio's Painting editor, the `asset-studio` skill |

Bob ruled this order on 2026-11-07 (DEC-843). Until 0.3, a Painting's move is written into the consumer's own data by hand, and the consumer plays it. How Bloodtower 1.0 plays named moves before `<Painting>` exists is Bloodtower's open question Q-451, not this repo's.

## What is settled (from the rulings)

| Ruling | What it means here |
|---|---|
| One CLI plus one studio (DEC-382) | The CLI does all the work headless, so an agent can drive it. The studio is for looking, listening, approving and the edits that need an eye |
| Own repo, absorbs talking-avatar (DEC-383) | This repo is renamed `bpaksi/asset-studio`. Neutral fixtures only: no story art, no Return to Dark Tower material |
| `@asset-studio` npm scope (DEC-390) | `@asset-studio/formats`, `/player`, `/cli`, `/studio` from 0.2.0. `@talking-avatar/*` 0.1.0 are deprecated with a pointer to the new names |
| Two modes (DEC-384) | **Studio mode:** the person brings the art and approves each draft. **AI mode:** the CLI makes every missing asset as a draft, art included, with no approval screen. Only a person moves an asset to final, in either mode |
| One generic job per story (DEC-385, DEC-623) | `asset-job.json` is the input contract. The consumer writes it. This repo never reads a consumer's own files |
| Status lives in the work folder (DEC-839) | The work folder's index owns `missing`, `draft`, `final`, `rejected`. The job has no status. Export hands status to the consumer |
| Work folder (DEC-394) | Required on first start, remembered in user settings outside any repo, changeable. Nothing runs until it is set |
| Masters and drafts outside git (DEC-386) | The work folder holds masters, WAVs and every draft. Only shipped files leave it, through export and the consumer's packaging. The work folder is backed up to OneDrive, and a lost one is restored from there |
| IDs (DEC-622, DEC-844) | `<kind>.<entry>~<variant>`, lowercase kebab-case. Taken from the job as given. asset-studio builds only `portrait.<speaker>`, `portrait.<speaker>~<mood>` and `glow.<entry>` itself |
| AI art (DEC-392) | A Gemini image model, with the same key as TTS, behind a provider interface. Mouth frames are edits of the portrait's mouth only, then the anchor box is pasted back onto the portrait so all frames match outside it |
| Mood stills and talking moods (DEC-719, DEC-842) | Every mood of every cast member is a still. A speaker gets a talking avatar (portrait, 8 mouths, anchor) only for a mood that one of its voiced lines uses. A cast member with no voice gets stills only |
| Chin line (DEC-841) | Asset contract v3 adds an optional `chin` (0–1 from the top) to the avatar manifest, set in the studio or proposed by AI mode. asset-studio only records it; the consumer's lint checks it |
| Camera moves (DEC-400, DEC-578) | A moment names a move from a list of seven, a speed and a focus box. A drawn camera track is the escape (camera-track contract v1) |
| Camera moves set in the studio (DEC-840) | Saved per moment in the work folder (`camera.json`), never in the job. Export carries them. The consumer writes them into its own data |
| Glow mask (DEC-401, DEC-844) | Its own asset, `glow.<entry>` for `painting.<entry>`: a greyscale WebP at the painting's exact size |
| Kinds and moods are labels (DEC-844) | A picture's `kind`, a sound's `kind` and a speaker's moods are strings asset-studio stores and filters by. It does not check them against a list; the consumer's lint does |
| Studio is web first (DEC-403) | A local web app now. `asset-studio-mac`, a thin SwiftUI shell around it, is a later plan |
| Skill (DEC-398) | This repo ships an `asset-studio` skill for using the CLI on any job. Bloodtower's `google-tts` skill retires into it |

## P1 steps this plan takes over

P1's S3 (TTS providers and cache), S4 (Rhubarb and whisper timing) and S6 (`--mp4`) were not built. P2 S4 takes over P1 S3, and P2 S11 takes over P1 S4, with their acceptance unchanged except that the output lands in the work folder and the index. S6 (`--mp4`) is dropped: the consumer plays `line.json` live and has no use for MP4. P1's *Formats*, *Timing*, *Pauses*, *Mouth set* and *Rhubarb JSON* sections still apply.

## Shape

```text
asset-job.json ──► asset-studio CLI ──────────────────────► work folder/<story>/
 (consumer)    needs · render · approve · reject · export   index.json   (status per ID)
               │                                            store/<hash>.<ext>  (content-addressed)
               ├─ voice: TTS → WAV master → m4a              masters/     (art kept by hand)
               ├─ picture: sizes per profile → WebP          notes.json   ("redo <ID>: <note>")
               ├─ glow mask: check, size match               camera.json  (studio moves, per moment; 0.3)
               ├─ ai: Gemini image → pictures, stills, masks (0.2); mouths (0.3)
               └─ avatar: Rhubarb timing → avatar folder (0.3)

studio (local web app) ──reads/writes──► the same work folder, through the CLI's library
export ──► a folder the consumer copies from: export index, media by hash, avatars/<id>/ in asset contract v3 (0.3), camera.json
```

- **Index** (`index.json` in the work folder): one entry per asset ID, with its kind, the file in `store/`, its size, a hash of its inputs, its status (`missing`, `draft`, `final`, `rejected`), and any notes. A re-render with the same inputs reuses the file. A re-render with new inputs writes a new file and keeps the old one. Only Approve and Reject (studio or CLI) change a status to `final` or `rejected`.
- **Notes** (`notes.json`): "redo `<ID>`: `<note>`" entries from the studio, or from an agent relaying the person's words. The next `render` passes a note to the AI provider as an extra instruction for that ID, and clears it once the new draft exists.
- **Camera edits** (`camera.json`, 0.3): moves set in the studio, keyed by moment ID. The job is never edited.

## Job contract (DEC-623, DEC-844; settles Bloodtower Q-286)

`docs/job-contract.md` is written in S2. The file is JSON, named `asset-job.json`. In outline:

```json
{
  "schema": 1,
  "story": "dracula",
  "source": "sha256:…",
  "style": {
    "picture": "oil painting, candlelit, muted palette",
    "references": ["ref/castle.webp"]
  },
  "profiles": {
    "dashboard": {"width": 1920, "height": 1080},
    "ipad": {"width": 1640, "height": 2360},
    "portrait": {"width": 720, "height": 900}
  },
  "cast": [
    {
      "id": "count",
      "name": "The Count",
      "voice": {"provider": "gemini-tts", "voiceId": "Charon", "style": "proud, patient, cold"},
      "captionTheme": "parchment",
      "moods": ["neutral", "friendly", "scared", "angry", "sly"],
      "portraits": [{"mood": "angry", "source": "art/count-angry.png"}, {"mood": "neutral", "prompt": "…"}],
      "references": ["ref/count-sheet.webp"]
    },
    {"id": "innkeeper", "name": "Innkeeper", "moods": ["neutral", "friendly", "scared", "angry", "sly"]}
  ],
  "lines": [
    {"id": "n1-house.02~vo-01", "speaker": "count", "mood": "angry", "text": "You come late. [pause 0.4] The others did not."}
  ],
  "pictures": [
    {"id": "painting.n1-house", "kind": "painting", "profiles": ["dashboard"], "prompt": "the burgomaster's stair at dawn", "glow": true},
    {"id": "foe.vampire", "kind": "foe", "profiles": ["dashboard", "ipad"], "source": "art/vampire.png"}
  ],
  "moments": [
    {"id": "n1-house.01", "picture": "painting.n1-house", "camera": {"move": "push-in", "speed": "slow", "focus": {"x": 0.6, "y": 0.4, "w": 0.3, "h": 0.3}}}
  ],
  "sounds": [
    {"id": "sound.door", "kind": "effect", "source": "sfx/door.wav"}
  ]
}
```

- `schema` is the contract version. `story` names the work-folder subfolder. `source` is the consumer's hash of the files it wrote the job from; asset-studio stores it with each render and copies it into the export, so the consumer can tell when its data has changed since.
- **Cast:** `voice` is optional. Without it, the cast member has stills only. `moods` lists every mood the member needs. `portraits[]` gives a `source` or a `prompt` per mood; a mood with neither is made in AI mode from `references` and the job's `style`, or stays `missing` in studio mode. Cast portraits use the `portrait` profile.
- **IDs asset-studio builds** (DEC-844): the neutral still or avatar is `portrait.<speaker>`, every other mood is `portrait.<speaker>~<mood>`, and a picture with `glow: true` also needs `glow.<entry>` (for `painting.n1-house`, `glow.n1-house`).
- **Lines:** only lines that are to be voiced. The consumer decides which (Bloodtower's DEC-349). A line's `mood` picks its avatar; with no mood it plays on the neutral one. A line's speaker must have a `voice`.
- **Moments:** a camera belongs to a moment, not a picture (DEC-401), so one painting in two moments can move two ways. `camera` is a named move (`move`, `speed`, `focus`) or a drawn track (`track`, camera-track contract v1). A moment with no camera plays its picture as a still.
- **Kinds** are labels (DEC-844). asset-studio stores and filters by them and checks nothing else about them.
- There is no `status` field anywhere in the job (DEC-839).
- Relative paths in the job resolve against the folder that holds `asset-job.json`.

## Named camera moves (DEC-578; settles Bloodtower Q-293)

`push-in`, `pull-out`, `pan-left`, `pan-right`, `tilt-up`, `tilt-down` and `drift`, where `drift` is the default. The first version's `reveal` move is gone, which also keeps it apart from Bloodtower's Reveal tool.

| Speed | Picture widths a second | Default length |
|---|---|---|
| `slow` | 0.02 | 20 s |
| `medium` | 0.035 | 12 s |
| `fast` | 0.05 (the cap) | 6 s |

Each move eases in and out and never goes past the picture's edge. With reduced motion, the end frame shows as a still. These are player constants for now, to be tuned on the TV (tv-display-poc's Pan tab).

## Steps

### G0: Bob approves the first version
- Result: Bob approved on 2026-10-28, with no code changes yet.

### G0b: Bob approves this revision
- Depends on: G0
- Touches: plans/P2-asset-studio.md
- Acceptance: approval is recorded here. It covers the job contract, the ID rules, the move list and the two-release order above. Bloodtower's DEC-844 (proposed) moves to decided with it.
- Result: Bob approved on 2026-11-07 ("Lets approve both plans"), together with Bloodtower A1's G0b. DEC-844 is decided. Next is B1, Bob's setup.

---

**Release 0.2 (Bloodtower 1.0)**

### S1: Rename to asset-studio
- Depends on: G0b, B1 (Bob's setup, below)
- Touches: package.json, packages/*/package.json, pnpm-lock.yaml, README.md, CHANGELOG.md, docs/**, .github/workflows/**, every import of `@talking-avatar/*`
- Acceptance:
  - The packages are `@asset-studio/formats`, `@asset-studio/player` and `@asset-studio/cli` at 0.2.0. Their exports, schemas and behaviour are unchanged, and every existing test passes.
  - The README says what asset-studio is. The asset contract keeps its name and its v2 number.
  - The release workflow publishes the `@asset-studio` names through trusted publishing. Releasing 0.2.0 of formats and player is a manual step for Bob, recorded here. (Bloodtower A1 step 1 can swap its pins as soon as these two are out.)
  - `npm deprecate` text for `@talking-avatar/formats` and `@talking-avatar/player` is written in CHANGELOG, for Bob to run.
- Result: built on `feat/s1-rename-asset-studio`, after this plan's revision (#14) and the camera-track lock (#13) merged. Packages renamed to `@asset-studio/*` at 0.2.0, with exports and tests unchanged. The camera-track contract and schema carry the new name. The P1 plan and the two 0.1.0 handoff notes stay as written, as history.
- Bob's release (manual): npm can't add a trusted publisher to a package that doesn't exist yet, so 0.2.0 of `@asset-studio/formats` then `@asset-studio/player` is published by hand from `main` (`pnpm pack`, then `npm publish <tgz> --access public`), as 0.1.0 was. Then add each package's trusted publisher (owner `bpaksi`, repo `asset-studio`, workflow `release.yml`) and run the two `npm deprecate` lines in CHANGELOG 0.2.0. Later versions go through Actions → release on `main`.

### S2: Job contract, index, notes and camera edits (formats)
- Depends on: S1
- Touches: packages/formats/**, docs/job-contract.md
- Acceptance:
  - `jobSchema` (Zod) matches *Job contract* above, and `docs/job-contract.md` documents it with the example.
  - `derivedIds(job)` returns every ID the job implies, including the ones asset-studio builds (portraits per mood, glow masks). Unit tests cover a voiced speaker, a voiceless cast member and a glow picture.
  - Validation fails with the field and id when: an id is a duplicate; an id is not `<kind>.<entry>~<variant>` in lowercase kebab-case (script line ids keep `<scene>.<moment>~<variant>`); a line's speaker is not in the cast; a line's speaker has no voice; a line names a mood its speaker lacks; a portrait names a mood not in its speaker's `moods`; a picture has neither `source` nor `prompt`; a picture names an unknown profile; a moment's picture is not in `pictures`; a camera move or speed is not on the list; a focus box is outside 0..1; the job has a `status` field.
  - A moment's drawn `track` is checked against the camera-track contract v1 schema once that contract is locked (talking-avatar PR #13). Until then a `track` fails as not yet supported.
  - `indexSchema`, `notesSchema` and `cameraEditsSchema` match *Shape* above.
  - Tests use generated fixtures.

### S3: CLI skeleton, settings, store and needs
- Depends on: S2
- Touches: packages/cli/src/{bin,config,store,needs}/**, packages/cli/package.json
- Acceptance:
  - The `asset-studio` bin has `config get|set workFolder`. Settings live in the per-user settings folder (macOS `~/Library/Application Support/asset-studio/settings.json`). Every command except `config` fails with code `AS-CONFIG-1` and the line "Set the work folder: asset-studio config set workFolder <path>" while none is set. A `--work-folder` flag overrides it for one run.
  - `asset-studio needs <asset-job.json>` lists every ID from `derivedIds` (in 0.2, a mood's portrait is listed as a still), each with its kind and its status from the index. `--json` prints the list as JSON.
  - `asset-studio approve <job> <id>` and `reject <job> <id> --note "<text>"` set the status in the index, and the note also goes to `notes.json`. These are the only ways to set `final` or `rejected`.
  - The store writes content-addressed files and never overwrites. Two runs with the same inputs give one file. Tests use temp folders.

### S3-seam: Command registry and placeholder commands
- Depends on: S3
- Touches: packages/cli/src/{bin,render,studio-command}/**, packages/cli/src/export/command.ts, packages/cli/src/index.ts (only to export registry types)
- Added 2026-11-08 so S4, S5, S7 and S8 can run in parallel without all editing `packages/cli/src/bin/`.
- Acceptance:
  - The dispatcher is async (`main` returns `Promise<number>`). Existing commands, usage text, exit codes and tests are unchanged.
  - A command module exports `{ name, usage, summary, options, run(ctx, args) }` and registers itself; `bin/commands.ts` is the single list of imports a later step extends with one line.
  - Placeholders: `render <job> [--only voice|picture] [--ai]` (`AS-RENDER-0`), `export <job> --out <folder> [--drafts]` (`AS-EXPORT-0`), `studio` (`AS-STUDIO-0`). Each needs the work folder (`AS-CONFIG-1`), validates its own flags (usage error, exit 2), then fails "not built yet" with exit 1.
  - `registerRenderer({ kind, ai?, render(ctx, job, paths) })` lets S4, S5 and S6 add renderers from their own folders. `render` runs every registered renderer for the requested kinds, keeps going after a failure, and ends non-zero with the failed count. If no registered renderer matches the requested kinds (plain `render` with only an AI renderer, or `--only <kind>` with none for it), it fails `AS-RENDER-3` naming every missing kind; it never reports success when nothing ran. A renderer that throws a `CliError` has its own code and lines printed and counts as failed; other throws are wrapped as `AS-RENDER-1`.
  - `--ai` runs the source renderers first, then the AI renderers fill what is still missing (S6).
  - A command may set `needsWorkFolder: false` (default true); `studio` does, so a first start with no folder reaches the command.
  - Tests cover each command's flags, the `AS-CONFIG-1` path, the coded failures, and the renderer registry with a fake renderer.

### S4: Voice (P1 S3)
- Depends on: S3
- Touches: packages/cli/src/{tts,voice}/**, packages/cli/src/bin/commands.ts (one import line only)
- Acceptance:
  - P1 S3's acceptance holds, and the Gemini provider absorbs Bloodtower's tts-explorer code (`apps/Visuals/src/tts-explorer/lib/gemini.ts`: the Interactions API for the 3.8 models, `generateContent` for older ones, the PCM-to-WAV wrap).
  - `asset-studio render <job> --only voice` makes a WAV master in `masters/` and an m4a draft in the store, with macOS `afconvert`, for each line. Its index entry is `draft`.
  - The Gemini key is read from `GEMINI_API_KEY` and is never written to the index, notes or logs. A missing key fails with `AS-VOICE-1`.
  - Every failed line is logged with its id and code, and the run ends non-zero with a count.

### S5: Pictures, stills and glow masks
- Depends on: S3
- Touches: packages/cli/src/{picture,glow}/**, packages/cli/package.json, pnpm-lock.yaml, packages/cli/src/bin/commands.ts (one import line only)
- Acceptance:
  - `render --only picture` makes one WebP per picture and profile from its `source`, cropped by cover to the profile's size, and one WebP per cast mood at the `portrait` profile from its portrait `source`. The master is kept in `masters/`.
  - A glow mask placed by hand (`masters/glow.<entry>.png`) is checked as greyscale at the painting's exact size, then stored as WebP. A wrong size fails with `AS-GLOW-1` and both sizes.
  - Uses `sharp`, at an exact pin. This is the only step in its batch that changes dependencies.

### S6: AI mode for pictures, stills and glow masks
- Depends on: S5
- Touches: packages/cli/src/ai/**, packages/cli/src/bin/commands.ts (one import line only)
- Acceptance:
  - An `ImageProvider` interface, with Gemini as its first provider. Tests use a fake provider.
  - `render --ai` makes every `missing` picture, mood still and glow mask as a draft: stills from the cast references and the job style, pictures from the prompt and the style, glow masks for pictures with `glow: true`.
  - A note in `notes.json` for an id goes into that id's next request and is cleared once the new draft is stored.
  - Every provider error is logged with the id and a code. A failed asset stays `missing`, and the run goes on with the next.

### S7: Studio, review
- Depends on: S3
- Touches: packages/studio/**, pnpm-lock.yaml, packages/cli/src/index.ts (export lines only), packages/cli/src/studio-command/**, .github/workflows/** (browser-install line only)
- Bob ruled 2026-11-08: the studio command calls `@asset-studio/studio` through a dynamic import, with no declared cli to studio dependency.
- Acceptance:
  - A local web app (`asset-studio studio`, 127.0.0.1 only). On first start with no work folder, it shows only a form for the path and saves it as `config set` does. The path can be changed later from a settings page.
  - It opens a job and shows the needs list with statuses and a filter by kind and status.
  - A draft voice line plays its m4a with its text as a caption. A picture shows at each profile's size, a mood still at the portrait size, a glow mask over its painting, and a sound plays.
  - Approve sets `final`. Reject sets `rejected` with a note, which also goes to `notes.json`. Both go through the CLI library, never by editing JSON in the page.
  - Every error the person causes shows on the page with its code.
  - Viewports: 1440×900 desktop.

### S8: Export
- Depends on: S3
- Touches: packages/cli/src/export/**, docs/export-contract.md
- Acceptance:
  - `asset-studio export <job> --out <folder> [--drafts]` copies every `final` asset (and every `draft` with `--drafts`) into the folder as `<hash>.<ext>`, and writes `export-index.json`: for each ID its kind, file, pixel size or length, status, and for a line its speaker and text. It also copies the job's `source` hash.
  - It never exports `rejected` or `missing` assets, masters or WAVs. A test covers each.
  - `docs/export-contract.md` documents the folder, so the consumer's packaging (Bloodtower A1 step 5) is built against it.

### S9: Release 0.2.x
- Depends on: S4, S5, S6, S7, S8
- Touches: CHANGELOG.md, packages/*/package.json, packages/*/README.md, packages/cli/tsconfig.build.json, .github/workflows/**, docs/releasing.md, examples/**, scripts/**, tests/packaging.test.ts
- Acceptance:
  - `@asset-studio/cli` and `@asset-studio/studio` are public.
  - A release run by hand from Actions (`workflow_dispatch` on `main`, no tag) publishes all four packages with provenance.
  - A fresh folder can install from npm and run `needs`, `render` (with the fake providers) and `export` against the repo's example job.

---

**Release 0.3 (Bloodtower 1.1)**

### S10: Asset contract v3, the chin line (formats)
- Depends on: S9
- Touches: packages/formats/**, docs/asset-contract.md, packages/cli/src/export/**
- Acceptance:
  - The avatar `manifest.json` takes an optional `chin`, a number 0..1, the chin's height from the top of the portrait. Out of range fails validation. Every v2 folder is a valid v3 folder, and a test proves it on the Keeper fixture.
  - The player ignores `chin`.
  - Export writes `chin` into the export index entry of a mood still too, when the index has one.

### S11: Talking avatars (P1 S4)
- Depends on: S10
- Touches: packages/cli/src/{align,avatar,needs}/**
- Acceptance:
  - P1 S4's acceptance holds.
  - `needs` now lists a talking avatar (portrait, 8 mouths, anchor) for each speaker and mood that a voiced line uses, and a still for every other mood (DEC-842). A new voiced line in a new mood adds that avatar as `missing`; the mood's still becomes its portrait draft.
  - `render --only avatar` writes one avatar folder per such speaker and mood in asset contract v3 (WebP portrait and mouths), and `validateAvatar` passes on each one. Export copies them as `avatars/<id>/`.
  - Rhubarb is found through `RHUBARB_PATH` or `PATH`. When it is missing, the run fails with `AS-ALIGN-1` and the install line. whisper stays optional: without it, the fallback word timings are used and one warning is logged.

### S12: AI mode for mouths and the chin
- Depends on: S6, S11
- Touches: packages/cli/src/ai/**
- Acceptance:
  - Mouth frames: 8 edits of the portrait that change only the mouth. Each one is pasted back through the anchor box onto the portrait, so all 8 frames are pixel-identical outside the box. A test checks that on a fake provider's output.
  - AI mode proposes a `chin` for each talking avatar and mood still. It stays a draft value until the asset is approved.

### S13: `<Painting>` player and the studio's Painting editor
- Depends on: S9, and talking-avatar PR #13 (camera-track contract v1 locked) merged
- Touches: packages/player/src/painting/**, packages/studio/src/{painting,portrait}/**, packages/formats/** (camera edits), packages/cli/src/export/**, packages/player/example/**
- Acceptance:
  - `<Painting>` in `@asset-studio/player` plays a picture with a named move from the list above, with an optional glow mask flickering at 1–2 Hz with jitter (never a strobe; steady under reduced motion). A drawn camera track (camera-track contract v1, with PR #13's rulings) is the escape. Unit tests cover each move's start and end frame.
  - The drawn track follows [camera-track contract v1](../docs/camera-track-contract.md), locked 2026-11-07: a camera clock that, given the moment-clock time, returns the frame (holds, the four `ease` values, the `letterbox-hold-push` prelude, reduced-motion cuts), with unit tests; CSS transforms only; `<Painting>` is a sibling of `<TalkingAvatar>`, never a wrapper. `@asset-studio/formats` exports the camera-object schema and its nine shape rules, with tests. The file and moment-id checks are the consumer's pack loader, not this repo.
  - Each scene's stills preload before it plays. The player example page (`packages/player/example/`) shows a drawn track, checked on a real iPad; memory and load time are recorded here (settled decision 6).
  - In the studio, the person picks a moment, a move, drags the focus box, picks a speed and previews it. Saving writes `camera.json` in the work folder through the CLI library, never the job (DEC-840). Export copies `camera.json`.
  - Glow masks are painted in the browser with a soft brush, and saved as a greyscale mask at the painting's size.
  - The person drags the chin line on a portrait or mood still, and it saves to the index.
  - Viewports: 1440×900 desktop.

### S14: The `asset-studio` skill
- Depends on: S12
- Touches: skills/asset-studio/**, README.md
- Acceptance:
  - A Claude Code skill that sets the work folder, runs `needs`, renders in studio or AI mode, takes "redo `<ID>`: `<note>`", exports, and auditions a voice. It covers what Bloodtower's `google-tts` skill does today.
  - It installs from this repo, and the README says how.

### S15: Release 0.3.x
- Depends on: S11, S12, S13, S14
- Touches: CHANGELOG.md, packages/*/package.json
- Acceptance:
  - A release run by hand from Actions (`workflow_dispatch` on `main`, no tag) publishes all four packages with provenance.
  - A fresh folder can install from npm and run `needs`, `render --only avatar` (with the fake providers and a stub Rhubarb) and `export` against the repo's example job, and the exported avatar passes `validateAvatar`.

## Bob's setup (B1, before S1)

- Rename the GitHub repo `bpaksi/talking-avatar` to `bpaksi/asset-studio`. GitHub keeps a redirect.
- Create the `asset-studio` npm org, and add trusted publishers for its four packages.
- Install Rhubarb Lip Sync (needed by S11, so it can wait for 0.3). ffmpeg is not needed.

## Batches

- B0: G0b, then B1 (Bob)
- B1: S1
- B2: S2
- B3: S3, then S3-seam (added 2026-11-08 to let B4 run in parallel)
- B4: S4, S5, S7, S8 (S5 is the only dependency change; merge order: S5, S4, S7, S8)
- B5: S6
- B6: S9 (0.2 release; Bloodtower A1 can build against it)
- B7: S10, S13 (S13 waits on PR #13)
- B8: S11
- B9: S12
- B10: S14, then S15

## Consumer follow-ups (Bloodtower plan A1)

Not this repo's work. A1 must change these to match, in its own PR:

- The job file is `asset-job.json` in the shape above (A1 steps 2 and 4), with `moments[]`, a voiceless cast for the default cast and shared faces, and no `status`.
- A1 step 1 waits on S1's 0.2.0 of formats and player. Steps 2, 4 and 5 wait on S9's 0.2 release, not on separate step releases.
- `assets:render --only avatar` arrives with 0.3 (S11). For 1.0 it is `voice` and `picture` only.
- `assets:pack` reads `export-index.json` for each file's status (DEC-839), and from 0.3 writes `camera.json` moves into the pack's moments (DEC-840), keeping the pack's move with a warning when the `source` hash no longer matches.
- A1 step 3's chin check reads `chin` from the avatar manifest or the export index (asset contract v3, 0.3). Until then no Portrait ships (1.0 has none).
- G-A1's sign-off splits: for 1.0, a voiced Loremaster line and a Painting with a glow mask; the Portrait with 2 lines moves to a 1.1 sign-off.
- Bloodtower Q-451: how 1.0's board plays a named move before `<Painting>` exists.

## Out of scope

- `asset-studio-mac` (DEC-403). It gets a plan of its own once the web studio works.
- Music and sound effect generation. Sounds are given as files and are only stored, indexed and exported.
- Anything that reads a consumer's own files.
