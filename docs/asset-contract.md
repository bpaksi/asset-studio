# asset-studio asset contract v2

Status: **v2** (current). v1 is locked; v2 is the new version. It changes one thing: `portrait` and `mouths/*` may be WebP as well as PNG. Everything else is as in v1, so every valid v1 folder is a valid v2 folder.

This is the file contract between the artist (Illusionist) and the code: `@asset-studio/formats` validates it, `@asset-studio/player` plays it, and consumers such as Bloodtower serve it as static files. It covers the first slice (S2 + thin S5). The fuller `cast.yaml` / `script.yaml` / `line.json` pipeline in [plans/P1-plan.md](../plans/P1-plan.md) still applies to the CLI.

## Layout

One folder per character:

```text
avatars/<id>/
  manifest.json
  portrait.webp         # or portrait.png
  anchor.json
  mouths/               # .webp preferred, .png also valid
    REST.webp
    MBP.webp
    CONS-EE.webp
    EH-AE.webp
    AH.webp
    OH-ER.webp
    OO-W.webp
    FV.webp
  lines/
    <line_id>.m4a
    <line_id>.json      # Rhubarb JSON
  masters/              # artist only, NOT shipped, NOT in git
    <line_id>.wav
    portrait.png
    mouths/
      <shape>.png
```

- **Image formats.** `portrait` and each mouth file are **WebP or PNG**, chosen by the file extension in `manifest.json`. Prefer WebP for shipped art: it is much smaller (Keeper's PNG set was about 20 MB) and keeps transparency for `overlay` mode. A character may mix formats, but the size and alpha rules apply to both.
- **Mouth file names.** The shape ids `CONS/EE`, `EH/AE`, `OH/ER`, `OO/W` contain `/`, which is not filesystem-safe. File names replace `/` with `-`: `CONS-EE.webp`, `EH-AE.webp`, `OH-ER.webp`, `OO-W.webp` (or `.png`). Shape ids inside JSON keep the `/` form.
- **Masters** are kept by the artist: WAV audio and PNG art masters (`masters/portrait.png`, `masters/mouths/*.png`). `masters/` is excluded from packaging and from the consumer's static build, and is git-ignored (`masters/` in `.gitignore`). Only `.m4a` audio and the shipped `.webp`/`.png` images ship. TTS segment files and other working files also stay out of the shipped folder.
- All paths inside `manifest.json` are **relative to `avatars/<id>/`**. No absolute paths.

## manifest.json

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | equals the folder name |
| `name` | string | display name |
| `portrait` | string | path to the portrait image (`.webp` preferred, or `.png`) |
| `anchor` | string | path to `anchor.json` |
| `mouths` | object | all 9 Rhubarb letters `X A B C D E F G H` → mouth image path (`.webp` preferred, or `.png`) |
| `mouthMode` | `"frame"` \| `"overlay"`, optional | default `"frame"`; see *Mouth mode* |
| `captionTheme` | string, optional | non-empty if present |
| `lines` | array | `{ line_id, audio, timing, text }` |

Letter map (fixed since v1; files shown with the preferred `.webp`, `.png` is equally valid):

| Letter | Shape | File |
| --- | --- | --- |
| X | `REST` | `mouths/REST.webp` |
| A | `MBP` | `mouths/MBP.webp` |
| B | `CONS/EE` | `mouths/CONS-EE.webp` |
| C | `EH/AE` | `mouths/EH-AE.webp` |
| D | `AH` | `mouths/AH.webp` |
| E | `OH/ER` | `mouths/OH-ER.webp` |
| F | `OO/W` | `mouths/OO-W.webp` |
| G | `FV` | `mouths/FV.webp` |
| H | `CONS/EE` | `mouths/CONS-EE.webp` |

Note: H → `CONS/EE` replaces the earlier P1 rule (H → `EH/AE` when the kit has no `L`). P1 is aligned to this contract.

Each `lines[]` entry:

- `line_id`: exactly the script's `line_id` (case and punctuation included). Unique in the manifest.
- `audio`: path to `lines/<line_id>.m4a`.
- `timing`: path to `lines/<line_id>.json`.
- `text`: the script line, `[pause N]` markup included. The player strips markup for captions.

## Mouth mode

`manifest.json` has an optional `mouthMode`: `"frame"` (default) or `"overlay"`.

- `frame`: every mouth file is the full portrait at the portrait's exact pixel size. The player swaps the whole image. The slice (the Keeper) uses this.
- `overlay` (later): every mouth file is a transparent WebP (or PNG) cropped to the anchor box. The player draws it over the portrait in the anchor box.

The validator checks mouth image sizes for the chosen mode. `anchor.json` is required in both modes.

## anchor.json

```json
{ "x": 0.508, "y": 0.649, "w": 0.26, "h": 0.29 }
```

All four values are fractions `0..1` of the portrait's width (`x`, `w`) and height (`y`, `h`). `x`, `y` is the **mouth center**; `w`, `h` is the mouth box size. In `overlay` mode every mouth image is drawn into this same box, so swaps do not jitter. In `frame` mode the mouth files are full portraits and the box only records where the mouth is.

The anchor is in fractions, not pixels, so the portrait can scale. P1's `cast.yaml` uses the same fractions.

## Timing

`lines/<line_id>.json` is Rhubarb's `--exportFormat json` output, unchanged:

```json
{
  "metadata": { "soundFile": "ts-keeper-001.wav", "duration": 7.4 },
  "mouthCues": [
    { "start": 0.0, "end": 0.03, "value": "X" },
    { "start": 0.03, "end": 0.14, "value": "H" }
  ]
}
```

Times are seconds. `metadata.soundFile` is informational; use a relative name, not an absolute path. Word timing is optional for the slice; captions show the whole line.

## Validation rules (S2 validator)

`@asset-studio/formats` rejects a character folder unless:

1. All 9 letters `X A B C D E F G H` are mapped in `mouths`.
2. Every referenced file exists: portrait, anchor, each mouth, each line's audio and timing. Portrait and mouth files must be PNG or WebP (checked by content, not extension); size and alpha checks (rule 8) apply to both. Lossy WebP without an alpha channel is opaque, so it fails `overlay` mode.
3. Each `line_id` is unique and has `audio`, `timing`, and `text`.
4. `anchor.x`, `y`, `w`, `h` are numbers in `0..1`.
5. Every cue `value` is one of `A B C D E F G H X`.
6. Cues are in order with no overlap: each cue has `start <= end`, and each cue's `start >=` the previous cue's `end`.
7. `captionTheme`, if present, is a non-empty string.
8. `mouthMode` is `"frame"` or `"overlay"` if present; if omitted it defaults to `"frame"`. Every mouth image is size-checked for the effective mode (omitted is checked as `"frame"`; see *Mouth mode*).
9. `id` equals the folder name.
10. Every path in `manifest.json` is relative to `avatars/<id>/`. No absolute paths.

Errors name the file and `line_id`.

## Example: the Keeper

`avatars/keeper/manifest.json`:

```json
{
  "id": "keeper",
  "name": "The Keeper",
  "portrait": "portrait.webp",
  "anchor": "anchor.json",
  "mouthMode": "frame",
  "mouths": {
    "X": "mouths/REST.webp",
    "A": "mouths/MBP.webp",
    "B": "mouths/CONS-EE.webp",
    "C": "mouths/EH-AE.webp",
    "D": "mouths/AH.webp",
    "E": "mouths/OH-ER.webp",
    "F": "mouths/OO-W.webp",
    "G": "mouths/FV.webp",
    "H": "mouths/CONS-EE.webp"
  },
  "lines": [
    {
      "line_id": "ts-keeper-001",
      "audio": "lines/ts-keeper-001.m4a",
      "timing": "lines/ts-keeper-001.json",
      "text": "Light them if you can. [pause 0.5] The key is at the bottom. It always is."
    },
    {
      "line_id": "ts-keeper-002",
      "audio": "lines/ts-keeper-002.m4a",
      "timing": "lines/ts-keeper-002.json",
      "text": "Mind the third step. It remembers everyone who ever fell on it."
    },
    {
      "line_id": "ts-keeper-003",
      "audio": "lines/ts-keeper-003.m4a",
      "timing": "lines/ts-keeper-003.json",
      "text": "Go on, then. I'll keep the lamp lit until you're back. I always do."
    }
  ]
}
```

`avatars/keeper/anchor.json` (measured by Illusionist on the approved portrait):

```json
{ "x": 0.508, "y": 0.649, "w": 0.263671875, "h": 0.29296875 }
```

## Delivery

Illusionist produces, per character: `portrait.webp`, the 8 mouth WebPs (sized for the `mouthMode`; PNG is also accepted), `anchor.json`, Rhubarb timing JSON per line, and `.m4a` per line. WAV and PNG masters are kept in `masters/` and are not delivered or committed.

Before merge, assets pass the gate:

- **Illusionist**: art and audio final, folder matches this contract.
- **Loremaster**: line text and `line_id`s match the script.
- **Gamewright**: lines fit the scene and play in the consumer.
- **Bob**: spot-check on the target device.

The S2 validator must pass first.
