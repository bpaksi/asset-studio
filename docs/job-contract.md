# asset-studio job contract v1

Status: **v1, built in [P2](../plans/P2-asset-studio.md) S2** (DEC-623, DEC-844). The code is in `@asset-studio/formats`: `jobSchema`, `derivedIds`, `indexSchema`, `notesSchema`, `cameraEditsSchema`.

A job is the one input file for a story. The consumer writes it, named `asset-job.json`. asset-studio never reads the consumer's own files. The example below uses made-up names and no real art.

## Example

```json
{
  "schema": 1,
  "story": "lantern-tale",
  "source": "sha256:abababababababababababababababababababababababababababababababab",
  "style": {
    "picture": "ink wash, warm light, muted palette",
    "references": ["ref/style.webp"]
  },
  "profiles": {
    "wide": { "width": 1920, "height": 1080 },
    "tall": { "width": 1640, "height": 2360 },
    "portrait": { "width": 720, "height": 900 }
  },
  "cast": [
    {
      "id": "keeper",
      "name": "The Keeper",
      "voice": { "provider": "gemini-tts", "voiceId": "Voice-A", "style": "calm" },
      "captionTheme": "parchment",
      "moods": ["neutral", "friendly", "angry"],
      "portraits": [
        { "mood": "angry", "source": "art/keeper-angry.png" },
        { "mood": "neutral", "prompt": "an old keeper with a lantern" }
      ],
      "references": ["ref/keeper-sheet.webp"]
    },
    { "id": "stranger", "name": "Stranger", "moods": ["neutral", "scared"] }
  ],
  "lines": [
    {
      "id": "scene-one.02~vo-01",
      "speaker": "keeper",
      "mood": "angry",
      "text": "You come late. [pause 0.4] The others did not."
    }
  ],
  "pictures": [
    {
      "id": "painting.scene-one",
      "kind": "painting",
      "profiles": ["wide"],
      "prompt": "a stair at dawn",
      "glow": true
    },
    {
      "id": "foe.wolf",
      "kind": "foe",
      "profiles": ["wide", "tall"],
      "source": "art/wolf.png"
    }
  ],
  "moments": [
    {
      "id": "scene-one.01",
      "picture": "painting.scene-one",
      "camera": {
        "move": "push-in",
        "speed": "slow",
        "focus": { "x": 0.6, "y": 0.4, "w": 0.3, "h": 0.3 }
      }
    }
  ],
  "sounds": [{ "id": "sound.door", "kind": "effect", "source": "sfx/door.wav" }]
}
```

This exact job (plus a second voiced line and a second moment) is the base of the tests in `packages/formats/src/job.test.ts`.

## Fields

Every object is strict: an unknown field is an error.

| Field | Type | Rule |
| --- | --- | --- |
| `schema` | `1` | the contract version |
| `story` | string | the work-folder subfolder; lowercase kebab-case |
| `source` | string | `sha256:` and 64 lowercase hex digits. The consumer's hash of the files it wrote the job from. asset-studio stores it with each render and copies it into the export, so the consumer can tell when its data has changed |
| `style` | object, optional | `picture` (text) and optional `references` (paths). Used in AI mode |
| `profiles` | object | name (kebab-case) to `{width, height}` in positive whole pixels. Cast portraits use the profile named `portrait` |
| `cast[]` | array | see below |
| `lines[]` | array | only the lines that are to be voiced; the consumer decides which |
| `pictures[]` | array | see below |
| `moments[]` | array | see below |
| `sounds[]` | array | see below |

**Cast member:** `id` (kebab-case), `name`, `voice` (optional: `provider`, `voiceId`, optional `style`), `captionTheme` (optional), `moods` (every mood the member needs; empty means audio-only, with no portraits), `portraits[]` (optional: `mood` and a `source` or a `prompt`), `references` (optional). Without a `voice` the member has stills only. A mood with neither a `source` nor a `prompt` is made in AI mode from `references` and the job's `style`, or stays `missing` in studio mode.

**Line:** `id`, `speaker` (a cast `id`), optional `mood` (plays on that mood's avatar; with none, on the neutral one), `text`.

**Picture:** `id`, `kind`, `profiles` (one or more profile names), `source` or `prompt` (at least one), optional `glow` (`true` asks for a glow mask).

**Moment:** `id`, `picture` (a picture `id`), optional `camera`. A camera belongs to a moment, not a picture (DEC-401), so one painting in two moments can move two ways. A moment with no camera plays its picture as a still.

**Sound:** `id`, `kind`, `source`.

**Kinds and moods are labels** (DEC-844). asset-studio stores and filters by them and checks nothing else about them, except that a mood must be lowercase kebab-case because it becomes part of an id.

**There is no `status` anywhere in the job** (DEC-839). Status lives in the work folder's index. A `status` field on the job or on any object in it fails validation.

## Camera

`camera` is one of:

- **A named move:** optional `move`, `speed` and `focus`. `move` is one of `push-in`, `pull-out`, `pan-left`, `pan-right`, `tilt-up`, `tilt-down`, `drift` (`drift` when none is named). `speed` is `slow`, `medium` or `fast`. `focus` is a box `{x, y, w, h}` of fractions of the picture, each from 0 to 1; this contract checks the range and nothing else about the box.
- **A drawn track:** `{ "track": { … } }`, checked against [camera-track contract v1](camera-track-contract.md) (`still`, `standeeOff`, `opening`, `cues`) with the rules of its *Validation rules* section. `track` cannot be combined with `move`, `speed` or `focus`.

Speeds and lengths of the named moves are player constants, in the [plan](../plans/P2-asset-studio.md).

## IDs

Every id is lowercase kebab-case: `<kind>.<entry>` with an optional `~<variant>`. Script line and moment ids use `<scene>.<moment>~<variant>`. The entry may carry more `.`-separated segments (`<scene>.<moment>.private.<hunter>`), as the camera-track contract's moment ids do. Ids are taken from the job as given. Cast ids, profile names and the story name are a single kebab-case segment.

Ids are unique across lines, pictures, moments, sounds and the ids asset-studio builds (below). A picture named `portrait.keeper` would collide with the neutral still of cast member `keeper`, and fails.

### Ids asset-studio builds (DEC-844)

| Id | When |
| --- | --- |
| `portrait.<speaker>` | every cast member with at least one mood in `moods`: the neutral still, or the neutral avatar |
| `portrait.<speaker>~<mood>` | every other mood in `moods`. A mood called `neutral` is `portrait.<speaker>`, never `~neutral` |
| `glow.<entry>` | a picture with `glow: true`; for `painting.scene-one`, `glow.scene-one` |

**No requested moods, no portraits.** A cast member whose `moods` is empty derives zero portrait assets, not even the neutral still. This is how an audio-only speaker (the Loremaster, say) stays portrait-free. Its lines still derive, and its `portrait.<speaker>` ids are not reserved, so a picture may use them without a collision.

`derivedIds(job)` returns, for a job that passed `jobSchema`, every asset the job implies as `{ id, kind, origin }`, in this order: per cast member its portraits (none for a member with empty `moods`), then lines (kind `line`), then each picture followed by its glow mask (kind `glow`), then sounds. `origin` is `job` for an id written in the job and `built` for one asset-studio builds. A picture's and a sound's `kind` is its own label. **Moments are not listed:** they have no file and no status.

For the example above: `portrait.keeper`, `portrait.keeper~friendly`, `portrait.keeper~angry`, `portrait.stranger`, `portrait.stranger~scared`, `scene-one.02~vo-01`, `painting.scene-one`, `glow.scene-one`, `foe.wolf`, `sound.door`.

## Validation

`jobSchema.safeParse(job)` fails with the field (`path`) and the id in the message when:

| Rule | Path of the issue |
| --- | --- |
| an id is a duplicate (the message names the first use) | the later id's field |
| an id is not `<kind>.<entry>~<variant>` in lowercase kebab-case | the `id` field |
| a line's speaker is not in the cast | `lines.N.speaker` |
| a line's speaker has no voice | `lines.N.speaker` |
| a line names a mood its speaker lacks | `lines.N.mood` |
| a portrait names a mood not in its speaker's `moods` | `cast.N.portraits.M.mood` |
| a picture has neither `source` nor `prompt` | `pictures.N` |
| a picture names an unknown profile (only profiles the job itself declares count; `constructor` and other inherited names are unknown) | `pictures.N.profiles.M` |
| a moment's picture is not in `pictures` | `moments.N.picture` |
| a camera move or speed is not on the list | `moments.N.camera.move` or `.speed` |
| a focus box value is outside 0..1 | `moments.N.camera.focus.x` (and `y`, `w`, `h`) |
| a drawn track breaks camera-track contract v1 | `moments.N.camera.track…` |
| the job, or anything in it, has a `status` field | the path of that `status` |

Every camera issue keeps its full indexed path and its message starts with `moment "<id>":`, so the moment that owns it is named.

Rules that need the consumer's files (a `source` path exists, a still exists) are not checked here; the consumer's lint and the CLI do that.

## Work-folder files

These are the other files the formats package describes. They are written by asset-studio, not by the consumer.

- **`index.json`** (`indexSchema`): an object keyed by asset id. Each entry has `kind`, `file` (a bare file name in `store/`), `size` (`{width, height}` in pixels or `{seconds}` for audio), `inputsHash` (`sha256:…` of the inputs that made the file), `status` (`missing`, `draft`, `final`, `rejected`) and `notes` (a list of strings). While `missing`, `file`, `size` and `inputsHash` are `null`; in every other status they are set.
- **`notes.json`** (`notesSchema`): an object keyed by asset id, each a non-empty list of "redo" notes. The next render passes them to the AI provider and clears them once the new draft exists.
- **`camera.json`** (`cameraEditsSchema`): an object keyed by moment id, each a `camera` as above (a named move or a drawn track). The job is never edited.

None of the three carries a version field yet.
