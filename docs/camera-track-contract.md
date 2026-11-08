# talking-avatar camera-track contract v1

Status: **locked (v1), 2026-11-07**. Bob answered the blocking questions ([issue #7](https://github.com/bpaksi/talking-avatar/issues/7)); see *Rulings (2026-11-07)*. It is built in [P2](../plans/P2-asset-studio.md) S9 as the drawn-track escape of `<Painting>`, not as a separate track.

This is the file contract for an optional camera track: pan and zoom over a still image, timed to the moment, so one wide image can stand in for several stills (Ken Burns). It is additive. [Asset contract v1](asset-contract.md) stays locked; character folders do not change.

P2 makes **named moves** (`push-in`, `pull-out`, `pan-left`, `pan-right`, `reveal`, DEC-400) the normal way to move a camera. A drawn camera track is the escape for a shot the named moves cannot make. `@asset-studio/formats` validates its shape and `<Painting>` in `@asset-studio/player` plays it. Consumers such as Bloodtower serve the stills as static files. Story, moment ids, and hunter art live in the consuming project.

JSON Schema: [camera-track.schema.json](camera-track.schema.json). Worked examples: [examples/camera-track.json](examples/camera-track.json).

## Settled decisions

From issue #7, its comments, and the design room (2026-10-17).

1. **Optional.** A still with no camera track is a static crop, as today.
2. **Start and end framing, timing cues, easing.** Each move names a start frame, an end frame, when it runs, and how it interpolates.
3. **Live CSS transforms** on the device, not rendered video. P2 dropped MP4 output (P1 S6), so there are no preview videos either.
4. **Preload** each scene's images before that scene plays.
5. **Ship compressed WebP/JPEG.** PNG masters stay with the artist, like `.wav` in asset contract v1. They are not packaged.
6. **Measure** memory and load time on a real iPad during the first Keeper in-game test before scaling stills up. 1024px mouth frames plus 2K-wide stills are the named risk on older iPads.
7. **One master, many cues.** Cast variants reuse their base master and carry their own camera cue.
8. **Per-moment `standeeOff`.** When true, character standees are off for that moment. Used by `.lid-choice` and `.08` (hunters are painted into those hero stills).
9. **Per-moment `opening`.** One settled option: start on the full-width shot with letterbox bars, hold, then push in.
10. **Per-moment still.** A moment may name its own hero still, overriding the default scene still. `.08` uses its own hero still. `.08~no-agnes` stays on still M3 with standees. `.08~fight-lost` on M4 is coming, so moment ids with `~variant` must be able to pick different stills.

## Rulings (2026-11-07)

Bob's answers to the questions that blocked code.

| # | Question | Ruling |
| --- | --- | --- |
| R1 | Where is it built | Inside P2 S9, beside the named moves: one `<Painting>` stage, one 0.2.x release, no MP4 step |
| R2 | Clock when a moment has two speakers | The **moment clock**: `t = 0` when the moment starts, then wall time across every line and the gaps between them. The host gives `<Painting>` the start time |
| R3 | `ease` values | A closed set: `linear`, `ease-in`, `ease-out`, `ease-in-out`. Default `ease-in-out`, as for named moves. Anything else fails validation |
| R4 | `letterbox-hold-push` | A prelude before cue 0 with fixed values (see *Opening*). Cue times count from the end of the prelude |
| R5 | Cues and audio of different length | Audio longer: the camera holds the last `to`. Cues longer: the moment ends on schedule and the camera stops where it is. Either way the host loader logs a warning naming the moment, because only it knows the audio length |
| R6 | Layout | The camera object sits **inline on the moment** in the consumer's own data (Bloodtower: the pack YAML). `still` names a file in the consumer's stills root (Bloodtower: the pack's flat `assets/`). No sidecar files, no catalog |
| R7 | Reduced motion | No opening and no motion. At each cue's `start` the frame **cuts** to that cue's `to`. Before the first cue it shows the first `from` |
| R8 | Who validates | Shape rules in `@asset-studio/formats`. Rules that need the consumer's files or audio (the still exists, the id is a real moment, R5's warning) in the host's pack loader, since this repo never reads a consumer's own files (P2) |
| R9 | How the stage fits `<TalkingAvatar>` | A **sibling**. `<Painting>` draws the still and its camera; the host lays `<TalkingAvatar>` (and any standees) over it. Neither wraps the other |

The draft's other choices stand as written: every `~variant` track is complete with no inheritance, a frame is centre plus size like `anchor.json`, and the cue fields are `start` / `end` / `from` / `to` / `ease`.

## Layout

Stills and camera objects live in the **consuming project**. This repo does not ship them.

A camera track is one object per moment id, including `~variant` ids, written on that moment. The still it shows is named on that object. Variants do not share an object with their base: `.08`, `.08~no-agnes`, and `.08~fight-lost` are three moments with three tracks, and may name three different stills.

Bloodtower example (a pack's flat `assets/` is the stills root):

```text
packs/<id>/
  pack.yaml                         # moments carry their camera objects inline
  assets/
    M3.webp                         # shared master, shipped
    n2-burgomasters-funeral.08.webp # hero still, shipped
```

- `still` is **relative to the stills root**. No absolute paths, no `..`.
- Shipped stills are WebP or JPEG. PNG masters stay in the artist's store or the asset-studio work folder and are never referenced from a track.
- Mouth kits stay under `avatars/<id>/` per asset contract v1. They are not stills.

## Camera object

| Field | Type | Rule |
| --- | --- | --- |
| `still` | string | relative path to the shipped still (WebP or JPEG). This is the image the camera moves over. Naming it is how a moment overrides the scene default |
| `standeeOff` | boolean, optional | default `false` (standees on). `true` turns character standees off for this moment |
| `opening` | `"letterbox-hold-push"`, optional | omitted: start on the first cue's `from`. Present: see *Opening* |
| `cues` | array | ordered camera moves; may be empty (static still, optional standee/opening flags still apply) |

The object has no `id`: the moment that holds it is its id. Errors name the moment id the host passes in.

Moment `id` grammar, aligned with the host pack's moment ids:

```text
moment-id := scene "." moment [ ".private." hunter ] { "~" variant }
```

`~variant` **replaces** the base of the same moment. Each variant carries its own complete track; `.08~no-agnes` does not read `.08`'s `still` or cues.

Each `cues[]` entry:

| Field | Type | Rule |
| --- | --- | --- |
| `start` | number | seconds on the moment clock (R2), `>= 0`, counted after any opening |
| `end` | number | seconds, `>= start` |
| `from` | frame | start framing |
| `to` | frame | end framing. A hold is `from` equal to `to` |
| `ease` | `linear`, `ease-in`, `ease-out`, `ease-in-out`, optional | how `from` interpolates to `to`. Default `ease-in-out`. Omit on a hold |

A **frame** is four fractions of the still, the same units as `anchor.json` in asset contract v1:

```json
{ "x": 0.50, "y": 0.48, "w": 0.62, "h": 0.35 }
```

| Field | Meaning |
| --- | --- |
| `x`, `y` | crop **center**, `0..1` of the still's width and height |
| `w`, `h` | crop size, `0..1` of the still's width and height |

The crop rectangle must stay inside the still: `x - w/2 >= 0`, `x + w/2 <= 1`, and the same for `y` / `h`. `w` and `h` are `> 0`.

Cues are in order with no overlap: each cue has `start <= end`, and each cue's `start >=` the previous cue's `end`. A gap between cues holds the previous `to` (or the first `from` before the first cue). After the last cue the camera holds its `to` until the moment ends (R5).

## Opening

`opening` is omitted, or the one settled option:

- `"letterbox-hold-push"`: a prelude that runs before the moment clock's cue times start (R4).
  1. **Hold, 1.5 s.** The full-width shot: `w: 1`, centred (`x: 0.5`, `y: 0.5`), `h` the still's height at the viewport's aspect. Black bars top and bottom crop the view to **2.39:1**.
  2. **Push, 1 s.** The bars ease out while the camera moves to `cues[0].from` with `ease-in-out` (or to the full-width shot without bars if `cues` is empty).
  3. Cue times count from the end of the push. A cue at `start: 0` begins 2.5 s after the moment starts.

The hold length, push length, bar colour and ratio are player constants, not file fields. They are starting values, to be tuned on the TV like the named-move speeds. Under reduced motion the opening is skipped (R7).

## Standees

Character standees are the host's hunter (or speaker) figures composited over the still. This contract only names the per-moment off switch.

- Omitted / `false`: standees may show. Where they go, how big, and who appears are host decisions.
- `true`: no standees for that moment.

Design-room uses: `.lid-choice` and `.08` set `standeeOff: true` because those hero stills have hunters painted in. `.08~no-agnes` leaves standees on and uses still M3.

## Still override and variants

The default scene still is a host concern (the shared master for that scene, e.g. M3). A camera object **overrides** it by setting `still`.

| Moment id | `still` | `standeeOff` |
| --- | --- | --- |
| `.08` | that moment's hero still | `true` |
| `.08~no-agnes` | shared master M3 | omitted / `false` |
| `.08~fight-lost` (coming) | shared master M4 | a story call for Gamewright, not a contract question |
| `.lid-choice` | that moment's hero still | `true` |
| cast variants of a shared master | that master | usually omitted |

## Playback (binds `<Painting>`, not file fields)

- Moves run as **CSS transforms** on the still. Never decode a video of the move.
- `<Painting>` is a sibling of `<TalkingAvatar>` (R9). The host stacks them.
- Time comes from the moment clock the host provides (R2), not from an audio element.
- Under `prefers-reduced-motion: reduce`, frames cut at each cue's `start` (R7).
- Preload every still a scene's reachable moments name before that scene plays.

## Validation rules

`@asset-studio/formats` rejects a camera object unless (shape, R8):

1. `still` is a relative path: no leading `/`, no `..` segment.
2. `still` ends in `.webp`, `.jpg`, or `.jpeg`. PNG is the master and is not referenced from the track.
3. `standeeOff`, if present, is a boolean.
4. `opening`, if present, is `"letterbox-hold-push"`.
5. Each frame `x`, `y` is in `0..1`; `w`, `h` are in `(0..1]`; the crop rectangle stays inside the still.
6. Each cue has `start >= 0`, `start <= end`, and each cue's `start >=` the previous cue's `end`.
7. `ease`, if present, is one of `linear`, `ease-in`, `ease-out`, `ease-in-out`, and is omitted when `from` equals `to`.
8. `cues` is an array (empty is allowed).
9. No unknown keys, on the object, a cue, or a frame.

The host's pack loader adds (R8):

- The `still` file exists in the stills root.
- The moment id holding the object is unique in the pack, and each `~variant` names a base moment that exists.
- A warning, not a failure, when the last cue's `end` (plus any opening) is past the moment's audio, or the audio runs past it (R5).

Errors name the moment id and the field.

## Example: funeral `.08` family

`.08` (hero still, standees off, letterbox hold then push in):

```json
{
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

Numbers in the examples (`6.4`, crop fractions) are **illustrative**. They are not measured from audio or art.

The same objects, keyed by moment id only as a reading aid, are in [examples/camera-track.json](examples/camera-track.json).

## Delivery

Illusionist produces, per shared master and per hero still: a wide PNG master (artwork beyond the tightest crop) and a shipped WebP or JPEG.

Gamewright (or the host author) writes one camera object on each moment that needs a move a named move cannot make, a hold, a still override, an opening, or `standeeOff`.

Authoring guidelines (Bob): give each move a story purpose; plan both the start and the end framing; leave artwork beyond the visible frame; check the tightest crop at delivery resolution; keep moves simple; hold still to let a line land.

Funeral slice count (Gamewright, Bob's hunter-art option (c)): 56 tagged still moments, 41 drawn today; with camera cues, **22 images** (23 if `.04~holy-symbol` gets its own image instead of the clip). Shared: 7 masters (M1, M1b, M2, M3, M4, M5, M6) + 2 hero shots (`.lid-choice`, `.08`) = 9. Private: 13.

## Still open (do not block code)

- **Standee placement.** Anchor points, size, who appears, and whether a standee is a talking-avatar portrait are host questions.
- **`.08~fight-lost`.** `standeeOff` and `opening` for that variant are story calls.
- **`.04~holy-symbol`.** 22 images, or 23 if it gets its own still instead of the clip.
- **Shipped max edge.** 2K-wide is a risk note, settled by the iPad measurement (decision 6), not a limit in this file.
