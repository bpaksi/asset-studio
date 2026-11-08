# @asset-studio/player

`<TalkingAvatar>`: a React component that plays one line of an asset-studio character folder with synced mouth shapes and a caption. MIT license.

```sh
pnpm add @asset-studio/player@0.2.0
```

`react` 18 or 19 is a peer dependency.

## Usage

Serve the character folder ([asset contract v1](https://github.com/bpaksi/asset-studio/blob/main/docs/asset-contract.md)) as static files, e.g. at `/avatars/keeper/`. The server must send `.m4a` as `audio/mp4` and answer `Range` requests with `206` (iPad Safari needs both).

```tsx
import { avatarManifestSchema } from "@asset-studio/formats";
import { TalkingAvatar } from "@asset-studio/player";

const manifest = avatarManifestSchema.parse(await (await fetch("/avatars/keeper/manifest.json")).json());

<TalkingAvatar
  manifest={manifest}
  lineId="ts-keeper-001"
  baseUrl="/avatars/keeper/"
  onEnd={() => next()}
/>;
```

| Prop | |
| --- | --- |
| `manifest` | parsed `manifest.json` |
| `lineId` | line to play; changing it plays the next line on the same audio element |
| `baseUrl` | URL of the character folder; manifest paths resolve against it |
| `onEnd` | called once when the line's audio ends |
| `onError` | optional; unknown `lineId`, timing that fails to load or parse, audio errors, unsupported `mouthMode` |
| `autoPlay` | default `true` |
| `className`, `style` | on the outer `<figure>` |

Behaviour:

- Every animation frame samples `audio.currentTime` and shows the mouth of the latest cue at or before it. `REST` before the first cue, after a cue's `end`, and once the audio has ended. Pause and seek follow `currentTime`.
- `mouthMode: "frame"`: each mouth file is a full portrait; the visible frame is swapped in the portrait's box and scales with it. `overlay` is not supported yet (portrait and caption only, plus `onError`).
- All mouth frames and every line's timing load when the component mounts; during playback only the audio is fetched.
- Caption: the line `text` with `[pause N]` removed. `captionTheme` is ignored for now.
- Browsers block audio without a user gesture. When `play()` is refused, the avatar shows a "Tap to play" button. Once a tap has started it, later lines on the same component play on their own, iPad Safari included.

## Example page

```sh
pnpm --filter @asset-studio/player example          # http://localhost:5173
pnpm --filter @asset-studio/player example --host   # reachable from an iPad on the same network
```

It plays the Keeper fixture from `@asset-studio/formats` (placeholder art and voice). Shape names are painted into the generated mouth PNGs; the player does not label frames.
