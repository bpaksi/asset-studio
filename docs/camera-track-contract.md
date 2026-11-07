# talking-avatar camera-track contract v1

Status: **draft (v1)**. Awaiting Bob's approval ([issue #7](https://github.com/bpaksi/talking-avatar/issues/7)). Not locked. Player code is out of scope until this document is approved. Field names that are not in the issue, its comments, or the design-room list are marked as **open questions** instead of being guessed.

This is the file contract for an optional camera track: pan and zoom over a still image, timed to spoken audio, so one wide image can stand in for several stills (Ken Burns). It is additive. [Asset contract v1](asset-contract.md) stays locked; character folders do not change.

`@talking-avatar/formats` will validate it and `@talking-avatar/player` will play it only after this draft is locked. Consumers such as Bloodtower serve the stills as static files. Story, moment ids, and hunter art live in the consuming project.

JSON Schema: [camera-track.schema.json](camera-track.schema.json). Worked examples: [examples/camera-track.json](examples/camera-track.json).

## Settled decisions

From issue #7, its comments, and the design room (2026-10-17).

1. **Optional.** A still with no camera track is a static crop, as today.
2. **Start and end framing, timing cues, easing.** Each move names a start frame, an end frame, when it runs, and how it interpolates.
3. **Live CSS transforms** on the device, not rendered video. ffmpeg video is for previews only.
4. **Preload** each scene's images before that scene plays.
5. **Ship compressed WebP/JPEG.** PNG masters stay with the artist, like `.wav` in asset contract v1. They are not packaged.
6. **Measure** memory and load time on a real iPad during the first Keeper in-game test before scaling stills up. 1024px mouth frames plus 2K-wide stills are the named risk on older iPads.
7. **One master, many cues.** Cast variants reuse their base master and carry their own camera cue.
8. **Per-moment `standeeOff`.** When true, character standees are off for that moment. Used by `.lid-choice` and `.08` (hunters are painted into those hero stills).
9. **Per-moment `opening`.** One settled option: start on the full-width shot with letterbox bars, hold, then push in.
10. **Per-moment still.** A moment may name its own hero still, overriding the default scene still. `.08` uses its own hero still. `.08~no-agnes` stays on still M3 with standees. `.08~fight-lost` on M4 is coming, so moment ids with `~variant` must be able to pick different stills.

Authoring guidelines (Bob): give each move a story purpose; plan both the start and the end framing; leave artwork beyond the visible frame; check the tightest crop at delivery resolution; keep moves simple; hold still to let a line land.

Funeral slice count (Gamewright, Bob's hunter-art option (c)): 56 tagged still moments, 41 drawn today; with camera cues, **22 images** (23 if `.04~holy-symbol` gets its own image instead of the clip). Shared: 7 masters (M1, M1b, M2, M3, M4, M5, M6) + 2 hero shots (`.lid-choice`, `.08`) = 9. Private: 13.

## Layout

Stills and camera files live in the **consuming project**. This repo does not ship them.

A camera track is one JSON object per moment id, including `~variant` ids. The still it shows is named on that object. Variants do not share a file with their base: `.08`, `.08~no-agnes`, and `.08~fight-lost` are three tracks and may name three different stills.

Suggested consumer layout (the path root is **open question 1**):

```text
stills/
  M3.webp                         # shared master, shipped
  n2-burgomasters-funeral.08.webp # hero still, shipped
  camera/
    n2-burgomasters-funeral.08.json
    n2-burgomasters-funeral.08~no-agnes.json
  masters/                        # artist only, NOT shipped
    M3.png
    n2-burgomasters-funeral.08.png
```

- All paths inside a camera JSON file are **relative to the stills root**. No absolute paths.
- Shipped stills are WebP or JPEG. PNG masters may live in `masters/` (or the artist's own store) and are excluded from packaging, as `avatars/<id>/masters/` is in asset contract v1.
- Mouth kits stay under `avatars/<id>/` per asset contract v1. They are not stills.

## camera JSON

One file (or one object in a catalog — **open question 2**) per moment id.

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | the moment id, including `~variant` segments. Unique in the set. Equals the file stem when the track is a sidecar file |
| `still` | string | relative path to the shipped still (WebP or JPEG). This is the image the camera moves over. Naming it is how a moment overrides the scene default |
| `standeeOff` | boolean, optional | default `false` (standees on). `true` turns character standees off for this moment |
| `opening` | `"letterbox-hold-push"`, optional | omitted: start on the first cue's `from`. Present: see *Opening* |
| `cues` | array | ordered camera moves; may be empty (static still, optional standee/opening flags still apply) |

Moment `id` grammar, aligned with the host pack's moment ids:

```text
moment-id := scene "." moment [ ".private." hunter ] { "~" variant }
```

`~variant` **replaces** the base of the same moment. Each variant is its own track. `.08~no-agnes` does not read `.08`'s `still` or cues unless this document later adds inheritance (**open question 3**).

Each `cues[]` entry:

| Field | Type | Rule |
| --- | --- | --- |
| `start` | number | seconds, `>= 0`. Clock: **open question 4** |
| `end` | number | seconds, `>= start` |
| `from` | frame | start framing |
| `to` | frame | end framing. A hold is `from` equal to `to` |
| `ease` | string, optional | how `from` interpolates to `to`. Allowed values: **open question 5**. Omit on a hold |

A **frame** is four fractions of the still, the same units as `anchor.json` in asset contract v1:

```json
{ "x": 0.50, "y": 0.48, "w": 0.62, "h": 0.35 }
```

| Field | Meaning |
| --- | --- |
| `x`, `y` | crop **center**, `0..1` of the still's width and height |
| `w`, `h` | crop size, `0..1` of the still's width and height |

The crop rectangle must stay inside the still: `x - w/2 >= 0`, `x + w/2 <= 1`, and the same for `y` / `h`. `w` and `h` are `> 0`.

Times are seconds. Cues are in order with no overlap: each cue has `start <= end`, and each cue's `start >=` the previous cue's `end`. A gap between cues holds the previous `to` (or the first `from` before the first cue, after any opening).

## Opening

`opening` is omitted, or the one settled option:

- `"letterbox-hold-push"`: start on the **full-width** shot of the still with letterbox bars, hold, then push in to the first cue's `from` (or stay there if `cues` is empty).

Hold length, bar colour, bar size, and whether the hold is a cue of its own are **open question 6**.

## Standees

Character standees are the host's hunter (or speaker) figures composited over the still. This contract only names the per-moment off switch.

- Omitted / `false`: standees may show (host places them; **open question 7**).
- `true`: no standees for that moment.

Design-room uses: `.lid-choice` and `.08` set `standeeOff: true` because those hero stills have hunters painted in. `.08~no-agnes` leaves standees on and uses still M3.

## Still override and variants

The default scene still is a host concern (the shared master for that scene, e.g. M3). A camera track **overrides** it by setting `still`.

| Moment id | `still` | `standeeOff` |
| --- | --- | --- |
| `.08` | that moment's hero still | `true` |
| `.08~no-agnes` | shared master M3 | omitted / `false` |
| `.08~fight-lost` (coming) | shared master M4 | not decided (**open question 8**) |
| `.lid-choice` | that moment's hero still | `true` |
| cast variants of a shared master | that master | usually omitted |

## Playback notes (not file fields)

These bind the later player. They are not JSON keys.

- Moves run as **CSS transforms** on the still. Do not decode a video of the move.
- The player in `mouthMode: "frame"` already swaps images live. Camera is the same idea applied to a still.
- Preload every still a scene's reachable moments name before that scene plays.
- ffmpeg (or equivalent) may render a preview MP4 from a track. Previews are not the runtime asset.
- `prefers-reduced-motion` behaviour is **open question 9**.

## Validation rules

A later `@talking-avatar/formats` check (or the host pack loader — **open question 10**) rejects a camera set unless:

1. Each `id` is unique and, for a sidecar file, equals the file stem.
2. Every `still` path is relative. No absolute paths. The file exists.
3. `still` is a `.webp`, `.jpg`, or `.jpeg` for the shipped file. PNG is the master and is not referenced from the track.
4. `standeeOff`, if present, is a boolean.
5. `opening`, if present, is `"letterbox-hold-push"`.
6. Each frame `x`, `y` is in `0..1`; `w`, `h` are in `(0..1]`; the crop rectangle stays inside the still.
7. Each cue has `start <= end`, `start >= 0`, and each cue's `start >=` the previous cue's `end`.
8. `ease` is omitted when `from` equals `to`. When present, it is a non-empty string (allowed set not locked).
9. `cues` is an array (empty is allowed).

Errors name the file and the moment `id`.

## Example: funeral `.08` family

`.08` (hero still, standees off, letterbox hold then push in):

```json
{
  "id": "n2-burgomasters-funeral.08",
  "still": "n2-burgomasters-funeral.08.webp",
  "standeeOff": true,
  "opening": "letterbox-hold-push",
  "cues": [
    {
      "start": 0,
      "end": 6.4,
      "from": { "x": 0.5, "y": 0.5, "w": 1, "h": 0.5625 },
      "to": { "x": 0.46, "y": 0.42, "w": 0.55, "h": 0.31 },
      "ease": "ease-in-out"
    }
  ]
}
```

`.08~no-agnes` (shared master M3, standees on, no letterbox opening):

```json
{
  "id": "n2-burgomasters-funeral.08~no-agnes",
  "still": "M3.webp",
  "cues": [
    {
      "start": 0,
      "end": 5.2,
      "from": { "x": 0.5, "y": 0.48, "w": 0.72, "h": 0.4 },
      "to": { "x": 0.5, "y": 0.48, "w": 0.72, "h": 0.4 }
    }
  ]
}
```

`.lid-choice` (hero still, standees off):

```json
{
  "id": "n2-burgomasters-funeral.lid-choice",
  "still": "n2-burgomasters-funeral.lid-choice.webp",
  "standeeOff": true,
  "cues": [
    {
      "start": 0,
      "end": 8,
      "from": { "x": 0.5, "y": 0.52, "w": 0.9, "h": 0.5 },
      "to": { "x": 0.5, "y": 0.52, "w": 0.9, "h": 0.5 }
    }
  ]
}
```

Numbers in the examples (`6.4`, crop fractions, `"ease-in-out"`) are **illustrative**. They are not measured from audio or art.

The same three objects, plus a coming `.08~fight-lost` stub, are in [examples/camera-track.json](examples/camera-track.json).

## Delivery

Illusionist produces, per shared master and per hero still: a wide PNG master (artwork beyond the tightest crop) and a shipped WebP or JPEG.

Gamewright (or the host author) produces one camera JSON object per moment that needs a move, a hold, a still override, an opening, or `standeeOff`.

Before a player implementation:

- **Illusionist**: masters painted wider than the viewport; tightest crop checked at delivery resolution.
- **Gamewright**: each move has a story purpose; variant ids pick the right still.
- **Bob**: approves this contract; later, iPad memory and load-time check.

The S2 character-folder validator does not read camera files. Camera validation is a later step, after lock.

## Open questions

Anything not in the settled list is here. Do not implement a guess.

1. **Stills root.** Where the consumer keeps stills and camera JSON (Bloodtower pack, `public/stills/`, next to the moment in YAML, or a catalog file).
2. **Sidecar vs catalog.** One JSON file per moment vs one array of tracks. The schema describes one track object; the example file wraps several in `tracks` only as a reading aid.
3. **Variant inheritance.** Does a `~variant` track inherit omitted fields from its base, or is every track complete? This draft treats every track as complete.
4. **Clock.** Issue #7 times the move to "the line's audio". Moments may have two speakers. Is the clock the first line, concatenated lines, `audio.currentTime` of the playing element (as mouths are), or a host clock?
5. **`ease` set.** The issue asks for easing. The allowed strings (CSS names, a cubic-bezier, a closed enum) are not chosen. `"ease-in-out"` in the example is not a decision.
6. **`letterbox-hold-push` timing and bars.** Hold duration; whether that hold is cue 0 or a prelude before `cues[0].start`; bar colour and thickness; whether full-width means `w: 1` on the still.
7. **Standee placement.** This contract only has `standeeOff`. Anchor points, size, who appears, and whether a standee is a talking-avatar portrait are host questions.
8. **`.08~fight-lost`.** Coming, on M4. `standeeOff` and `opening` for that variant are not decided.
9. **`prefers-reduced-motion`.** Snap to `to`, skip the opening, hold `from`, or ignore?
10. **Who validates.** `@talking-avatar/formats` vs the host pack loader.
11. **Cue vs audio length.** If the last `end` is past the audio, or the audio runs past the last cue: hold `to`, freeze, or loop? Not decided.
12. **Gamewright's draft cue format.** Issue comment [on #7](https://github.com/bpaksi/talking-avatar/issues/7#issuecomment-6227949665) says this PR uses it. The JSON was not in the issue body or comments. The `start` / `end` / `from` / `to` shape here follows this repo's Rhubarb cues and `anchor.json` fractions. Replace the names if Gamewright's draft differs.
13. **Crop origin.** This draft uses **center + size**, like `anchor.json`. Top-left + size is an alternative.
14. **`.04~holy-symbol`.** Counted as 22 images, or 23 if it gets its own still instead of the clip. Not a camera-file question until someone picks.
15. **Shipped max edge.** 2K-wide is a risk note, not a limit in this file.
