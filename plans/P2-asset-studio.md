# P2 plan: talking-avatar becomes asset-studio

Status: **approved by Bob (G0 passed), 2026-10-28**, including the job contract and the camera move list. No code yet: no step starts until Bob says so.

## Goal

This repo grows from talking avatars into **asset-studio**: a story-neutral CLI and a local web studio that turn a job (a cast, lines, pictures and sounds) into finished media files. Talking avatars are one part of it. Voice, pictures, Painting camera moves, glow masks, AI art and draft-to-final review are the rest.

The consumer is Bloodtower (`bpaksi/bloodtower`). Its rulings are its game-design cards DEC-382 to DEC-403 (session 2026-10-28, PR bpaksi/bloodtower#298). This plan repeats what the code needs from them, so it can be read without the cards. Bloodtower's side (pack to job, its lint, packaging into a pack, the `bt-assets` skill) is Bloodtower plan A1, not this repo.

## What is settled (from the rulings)

| Ruling | What it means here |
|---|---|
| One CLI plus one studio (DEC-382) | The CLI does all the work headless, so an agent can drive it. The studio is for looking, listening, approving and the edits that need an eye |
| Own repo, absorbs talking-avatar (DEC-383) | This repo is renamed `bpaksi/asset-studio`. Neutral fixtures only: no story art, no Return to Dark Tower material |
| `@asset-studio` npm scope (DEC-390) | `@asset-studio/formats`, `/player`, `/cli`, `/studio` from 0.2.0. `@talking-avatar/*` 0.1.0 are deprecated with a pointer to the new names |
| Two modes (DEC-384) | **Studio mode:** the person brings the art and approves each draft. **AI mode:** the CLI makes every missing asset as a draft, art included, with no approval screen. Only a person moves an asset to final, in either mode |
| One generic job per story (DEC-385) | The job is the input contract. The consumer writes it; this repo never reads a consumer's own files |
| Work folder (DEC-394) | Required on first start, remembered in user settings outside any repo, changeable. Nothing runs until it is set |
| Masters and drafts outside git (DEC-386) | The work folder holds masters, WAVs and every draft. Only shipped files leave it, through the consumer's packaging |
| AI art (DEC-392) | A Gemini image model, with the same key as TTS, behind a provider interface. Mouth frames are edits of the portrait's mouth only, then the anchor box is pasted back onto the portrait so all frames match outside it |
| Camera moves (DEC-400) | A Painting names a move from a short list, plus a focus box. A drawn camera track is allowed as an escape |
| Glow mask (DEC-401) | Its own asset, `<painting-id>.glow`: a greyscale WebP at the painting's exact size |
| Studio is web first (DEC-403) | A local web app now. `asset-studio-mac`, a thin SwiftUI shell around it, is a later plan |
| Skill (DEC-398) | This repo ships an `asset-studio` skill for using the CLI on any job. Bloodtower's `google-tts` skill retires into it |

## P1 steps this plan takes over

P1's S3 (TTS providers and cache), S4 (Rhubarb and whisper timing) and S6 (`--mp4`) were not built. P2 S4 and S5 take over S3 and S4 with their acceptance unchanged, except that the output lands in the work folder and the index. S6 (`--mp4`) is dropped: the consumer plays `line.json` live and has no use for MP4. P1's *Formats*, *Timing*, *Pauses*, *Mouth set* and *Rhubarb JSON* sections still apply.

## Shape

```text
job.json ──► asset-studio CLI ─────────────────────────► work folder/<job>/
 (consumer)    needs · render · approve · reject · export   index.json
               │                                            store/<hash>.<ext>  (content-addressed)
               ├─ voice: TTS → WAV master → m4a              masters/ (art kept by hand)
               ├─ avatar: Rhubarb timing → avatar folder     notes.json
               ├─ picture: sizes per screen → WebP
               ├─ glow mask: check, size match
               └─ ai: Gemini image → portrait, mouths, paintings, masks (drafts)

studio (local web app) ──reads/writes──► the same work folder, through the CLI's library
export ──► a folder the consumer copies from: avatars/<id>/ in asset contract v2, other media by hash, export index
```

- **Index** (`index.json` in the work folder): one entry per asset ID, with its kind, the file in `store/`, its size, a hash of its inputs, its status (`missing`, `draft`, `final`, `rejected`), and any notes. A re-render with the same inputs reuses the file. A re-render with new inputs writes a new file and keeps the old one.
- **Notes** (`notes.json`): "redo `<ID>`: `<note>`" entries from the studio, or from an agent relaying the person's words. The next `render` passes a note to the AI provider as an extra instruction for that ID, and clears it once the new draft exists.

## Proposed job contract (settles Bloodtower Q-286; Bob approves with this plan)

`docs/job-contract.md` is written in S2. In outline:

```yaml
job: dracula                 # id; also the work-folder subfolder name
style:                       # used by AI mode only
  picture: "oil painting, candlelit, muted palette"   # free text
  references: [ref/castle.webp]                       # files relative to the job file
profiles:                    # screen sizes the consumer wants
  dashboard: {width: 1920, height: 1080}
  ipad: {width: 1640, height: 2360}
cast:
  - id: agnes
    name: Sister Agnes Hallow
    voice: {provider: gemini-tts, voiceId: Kore, style: "calm, dry, quietly stern"}
    captionTheme: parchment            # optional, as in contract v2
    moods: [neutral, angry]            # each mood is a full avatar: portrait, 8 mouths, anchor
    references: [ref/agnes-sheet.webp] # AI mode
lines:
  - {id: n1-house.02.vo-01, speaker: agnes, mood: neutral, text: "He fought. [pause 0.4] There's skin under his nails."}
pictures:
  - id: n1-house.01
    profiles: [dashboard]
    source: art/n1-house-01.png        # studio mode; or
    prompt: "the burgomaster's stair at dawn"   # AI mode
    glow: true                         # wants a <id>.glow mask
    camera: {move: push-in, focus: {x: 0.6, y: 0.4, w: 0.3, h: 0.3}, speed: slow}
sounds:
  - {id: n1-house.sfx.door, kind: sfx, source: sfx/door.wav}
```

- A cast id with moods makes one avatar per mood, `<id>~<mood>`. The neutral mood is just `<id>`.
- A line's `mood` picks the avatar it plays on. With no mood given, the line plays on the neutral avatar.
- The job holds only what is to be made. The consumer decides which lines are voiced (Bloodtower's DEC-349) before writing it.

## Proposed named camera moves (settles Bloodtower Q-293; Bob approves with this plan)

`push-in`, `pull-out`, `pan-left`, `pan-right` and `reveal` (start on the whole picture, end on the focus box). Each move has three speeds: `slow` is 12 s, `medium` is 8 s and `fast` is 5 s for the whole move, eased in and out, and never past the picture's edge. With reduced motion, the end frame shows as a still. These are starting values, to be tuned on the TV (tv-display-poc's Pan tab).

## Steps

### G0: Bob approves this plan
- Depends on: none
- Touches: plans/P2-asset-studio.md
- Acceptance: approval is recorded here. That approval covers the proposed job contract and the camera move list.
- Result: Bob approved on 2026-10-28, with no code changes yet.

### S1: Rename to asset-studio
- Depends on: G0, B1 (Bob's setup, below)
- Touches: package.json, packages/*/package.json, pnpm-lock.yaml, README.md, CHANGELOG.md, docs/**, .github/workflows/**, every import of `@talking-avatar/*`
- Acceptance:
  - The packages are `@asset-studio/formats`, `@asset-studio/player` and `@asset-studio/cli` at 0.2.0. Their exports, schemas and behaviour are unchanged, and every existing test passes.
  - The README says what asset-studio is. The asset contract keeps its name and its v2 number.
  - The release workflow publishes the `@asset-studio` names through trusted publishing. Releasing 0.2.0 of formats and player is a manual step for Bob, recorded here.
  - `npm deprecate` text for `@talking-avatar/formats` and `@talking-avatar/player` is written in CHANGELOG, for Bob to run.

### S2: Job contract, index and work folder (formats)
- Depends on: S1
- Touches: packages/formats/**, docs/job-contract.md
- Acceptance:
  - `jobSchema` (Zod) matches the job contract above.
  - Validation fails with the field and id when: an id is a duplicate; a line's speaker is not in the cast; a line names a mood its speaker lacks; a picture has neither `source` nor `prompt`; a camera move is not on the list; a focus box is outside 0..1; a profile is unknown.
  - `indexSchema` and `notesSchema` match *Shape* above.
  - Tests use generated fixtures.

### S3: CLI skeleton, settings and store
- Depends on: S2
- Touches: packages/cli/src/{bin,config,store,needs}/**, packages/cli/package.json
- Acceptance:
  - The `asset-studio` bin has `config get|set workFolder`. Settings live in the per-user settings folder (macOS `~/Library/Application Support/asset-studio/settings.json`). Every command except `config` fails with code `AS-CONFIG-1` and the line "Set the work folder: asset-studio config set workFolder <path>" while none is set. A `--work-folder` flag overrides it for one run.
  - `asset-studio needs <job.json>` lists every asset ID the job implies (avatars per mood, lines, pictures per profile, glow masks, sounds), each with its status from the index. `--json` prints the list as JSON.
  - The store writes content-addressed files and never overwrites. Two runs with the same inputs give one file. Tests use temp folders.

### S4: Voice (P1 S3)
- Depends on: S3
- Touches: packages/cli/src/{tts,voice}/**
- Acceptance:
  - P1 S3's acceptance holds, and the Gemini provider absorbs Bloodtower's tts-explorer code (`apps/Visuals/src/tts-explorer/lib/gemini.ts`: the Interactions API for the 3.8 models, `generateContent` for older ones, the PCM-to-WAV wrap).
  - `asset-studio render <job> --only voice` makes a WAV master in `masters/` and an m4a draft in the store, with macOS `afconvert`. Its index entry is `draft`.
  - The Gemini key is read from `GEMINI_API_KEY` and is never written to the index, notes or logs. A missing key fails with `AS-VOICE-1`.
  - Every failed line is logged with its id and code, and the run ends non-zero with a count.

### S5: Talking avatars (P1 S4)
- Depends on: S4
- Touches: packages/cli/src/{align,avatar}/**
- Acceptance:
  - P1 S4's acceptance holds.
  - `render --only avatar` writes one avatar folder per cast id and mood in asset contract v2 (WebP portrait and mouths), and `validateAvatar` passes on each one.
  - Rhubarb is found through `RHUBARB_PATH` or `PATH`. When it is missing, the run fails with `AS-ALIGN-1` and the install line (Rhubarb is not installed on Bob's Mac today). whisper stays optional: without it, the fallback word timings are used and one warning is logged.

### S6: Pictures and glow masks
- Depends on: S3
- Touches: packages/cli/src/{picture,glow}/**, packages/cli/package.json, pnpm-lock.yaml
- Acceptance:
  - `render --only picture` makes one WebP per picture and profile from the `source`, cropped by cover to the profile's size. The master is kept in `masters/`.
  - A glow mask placed by hand (`masters/<id>.glow.png`) is checked as greyscale at the picture's exact size, then stored as WebP. A wrong size fails with `AS-GLOW-1` and both sizes.
  - Uses `sharp`, at an exact pin. This is the only step in its batch that changes dependencies.

### S7: AI mode (Gemini image)
- Depends on: S5, S6
- Touches: packages/cli/src/ai/**
- Acceptance:
  - An `ImageProvider` interface, with Gemini as its first provider. Tests use a fake provider.
  - `render --ai` makes every `missing` art asset as a draft: portraits per mood from the cast references and the job style; paintings from the prompt and the style; glow masks for pictures with `glow: true`.
  - Mouth frames: 8 edits of the portrait that change only the mouth. Each one is pasted back through the anchor box onto the portrait, so all 8 frames are pixel-identical outside the box. A test checks that on a fake provider's output.
  - A note in `notes.json` for an id goes into that id's next request and is cleared once the new draft is stored.
  - Every provider error is logged with the id and a code. A failed asset stays `missing`, and the run goes on with the next.

### S8: Studio, review
- Depends on: S3
- Touches: packages/studio/**
- Acceptance:
  - A local web app (`asset-studio studio`, 127.0.0.1 only). On first start with no work folder, it shows only a form for the path and saves it as `config set` does. The path can be changed later from a settings page.
  - It opens a job and shows the needs list with statuses and a filter.
  - A draft avatar line plays with `<TalkingAvatar>` from `@asset-studio/player`, the same component the game uses. A picture shows at each profile's size, and a sound plays.
  - Approve sets `final`. Reject sets `rejected` with a note, which also goes to `notes.json`. Both write through the CLI library, never by editing JSON in the page.
  - Every error the person causes shows on the page with its code.
  - Viewports: 1440×900 desktop.

### S9: Studio, Painting editor and player
- Depends on: S6, S8
- Touches: packages/player/src/painting/**, packages/studio/src/painting/**, packages/formats/src/camera*, packages/player/example/**
- Acceptance:
  - `<Painting>` in `@asset-studio/player` plays a picture with a named move from the list above, with an optional glow mask flickering at 1–2 Hz with jitter (never a strobe; steady under reduced motion). A drawn camera track (the camera-track contract v1) is the escape. Unit tests cover each move's start and end frame.
  - The drawn track follows [camera-track contract v1](../docs/camera-track-contract.md), locked 2026-11-07: a camera clock that, given the moment-clock time, returns the frame (holds, the four `ease` values, the `letterbox-hold-push` prelude, reduced-motion cuts), with unit tests; CSS transforms only; `<Painting>` is a sibling of `<TalkingAvatar>`, never a wrapper. `@asset-studio/formats` exports the camera-object schema and its nine shape rules, with tests. The file and moment-id checks are the consumer's pack loader, not this repo.
  - Each scene's stills preload before it plays. The player example page (`packages/player/example/`) shows a drawn track, checked on a real iPad; memory and load time are recorded here (settled decision 6).
  - In the studio, the person picks a move, drags the focus box, picks a speed and previews it. Saving writes the job's `camera` field through the CLI.
  - Glow masks are painted in the browser with a soft brush, and saved as a greyscale mask at the picture's size.
  - Viewports: 1440×900 desktop.

### S10: The `asset-studio` skill
- Depends on: S7
- Touches: skills/asset-studio/**, README.md
- Acceptance:
  - A Claude Code skill that sets the work folder, runs `needs`, renders in studio or AI mode, takes "redo `<ID>`: `<note>`", and auditions a voice. It covers what Bloodtower's `google-tts` skill does today.
  - It installs from this repo, and the README says how.

### S11: Release 0.2.x
- Depends on: S8, S9, S10
- Touches: CHANGELOG.md, packages/*/package.json
- Acceptance:
  - `@asset-studio/cli` and `@asset-studio/studio` are public.
  - A tagged release publishes all four packages with provenance.
  - A fresh folder can install from npm and run `needs` and `render` against the repo's example job.

## Bob's setup (B1, before S1)

- Rename the GitHub repo `bpaksi/talking-avatar` to `bpaksi/asset-studio`. GitHub keeps a redirect.
- Create the `asset-studio` npm org, and add trusted publishers for its four packages.
- Install Rhubarb Lip Sync (needed by S5). ffmpeg is not needed.

## Batches

- B0: G0, then B1 (Bob)
- B1: S1
- B2: S2
- B3: S3
- B4: S4, S6, S8 (S6 is the only dependency change; merge order: S6, S4, S8)
- B5: S5, S9
- B6: S7
- B7: S10, then S11

## Out of scope

- `asset-studio-mac` (DEC-403). It gets a plan of its own once the web studio works.
- Music and sound effect generation. Sounds are given as files and are only stored and indexed.
- Anything that reads a consumer's own files.
