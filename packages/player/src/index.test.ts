import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { avatarManifestSchema } from "@asset-studio/formats";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  assetUrl,
  captionFor,
  createMouthClock,
  letterAt,
  type MouthCue,
  mouthFiles,
  sampleAudioClock,
  TalkingAvatar,
  visibleShape,
} from "./index.js";

const cues: MouthCue[] = [
  { start: 0.1, end: 0.3, value: "D" },
  { start: 0.3, end: 0.5, value: "B" },
  { start: 0.5, end: 0.8, value: "A" },
];

describe("letterAt (cue lookup)", () => {
  it("is REST before the first cue, and the first letter at its start", () => {
    expect(letterAt(cues, 0)).toBe("X");
    expect(letterAt(cues, 0.099)).toBe("X");
    expect(letterAt(cues, 0.1)).toBe("D");
  });

  it("holds the latest cue at or before the time, between cue starts", () => {
    expect(letterAt(cues, 0.2)).toBe("D");
    expect(letterAt(cues, 0.3)).toBe("B");
    expect(letterAt(cues, 0.49)).toBe("B");
    expect(letterAt(cues, 0.6)).toBe("A");
  });

  it("follows a seek in either direction (no state between samples)", () => {
    expect(letterAt(cues, 0.7)).toBe("A");
    expect(letterAt(cues, 0.15)).toBe("D");
    expect(letterAt(cues, 0.45)).toBe("B");
  });

  it("holds the last cue until its end, then REST while audio remains", () => {
    expect(letterAt(cues, 0.79)).toBe("A");
    expect(letterAt(cues, 0.8)).toBe("X");
    expect(letterAt(cues, 2.5)).toBe("X");
  });

  it("is REST after the audio has ended, whatever currentTime says", () => {
    expect(letterAt(cues, 0.6, true)).toBe("X");
  });

  it("is REST with no cues or a non-finite time", () => {
    expect(letterAt([], 0.4)).toBe("X");
    expect(letterAt(cues, Number.NaN)).toBe("X");
  });
});

describe("createMouthClock", () => {
  it("samples currentTime each frame, reports changes only, and stops when audio stops", () => {
    const audio = { currentTime: 0, paused: false, ended: false };
    const frames: (() => void)[] = [];
    const letters: string[] = [];
    const clock = createMouthClock({
      audio,
      cues: () => cues,
      onLetter: (letter) => letters.push(letter),
      scheduler: {
        request: (callback) => frames.push(callback),
        cancel: () => {},
      },
    });
    const frame = (time: number) => {
      audio.currentTime = time;
      frames.shift()?.();
    };

    clock.start();
    frame(0.12);
    frame(0.2);
    frame(0.35);
    frame(0.15); // seek back
    audio.paused = true;
    frame(0.16);
    expect(frames).toHaveLength(0);
    expect(letters).toEqual(["X", "D", "B", "D"]);

    audio.paused = false;
    audio.ended = true;
    clock.sample();
    expect(letters.at(-1)).toBe("X");
  });
});

describe("assets and captions", () => {
  it("resolves manifest paths against the base URL", () => {
    expect(assetUrl("/avatars/keeper/", "mouths/AH.png")).toBe(
      "/avatars/keeper/mouths/AH.png",
    );
    expect(assetUrl("/avatars/keeper", "./portrait.png")).toBe(
      "/avatars/keeper/portrait.png",
    );
    expect(assetUrl("/avatars/keeper/", "mouths/AH.webp")).toBe(
      "/avatars/keeper/mouths/AH.webp",
    );
  });

  it("strips pause markup from captions, even malformed markup", () => {
    expect(captionFor("Light them. [pause 0.5] The key.")).toBe(
      "Light them. The key.",
    );
    expect(captionFor("Wait [pause x] here [pause")).toBe("Wait here");
  });

  it("lists each mouth file once", () => {
    expect(
      mouthFiles({ B: "m/CONS-EE.png", H: "m/CONS-EE.png", X: "m/REST.png" }),
    ).toEqual(["m/CONS-EE.png", "m/REST.png"]);
    expect(
      mouthFiles({
        B: "m/CONS-EE.webp",
        H: "m/CONS-EE.webp",
        X: "m/REST.webp",
      }),
    ).toEqual(["m/CONS-EE.webp", "m/REST.webp"]);
  });

  it("keeps the 0.0.0 playback helpers", () => {
    expect(sampleAudioClock({ currentTime: 0.4 })).toBe(0.4);
    expect(
      visibleShape({
        cues: [{ time: 0.4, shape: "MBP" }],
        time: 0.4,
        audioAvailable: false,
        reducedMotion: false,
      }),
    ).toBe("REST");
  });
});

describe("<TalkingAvatar> markup", () => {
  const manifest = avatarManifestSchema.parse(
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../formats/fixtures/keeper/manifest.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ),
  );

  it("renders the portrait, every mouth frame preloaded with REST visible, the caption and the audio", () => {
    const html = renderToStaticMarkup(
      createElement(TalkingAvatar, {
        manifest,
        lineId: "ts-keeper-001",
        baseUrl: "/avatars/keeper/",
      }),
    );
    expect(html).toContain('src="/avatars/keeper/portrait.png"');
    for (const file of mouthFiles(manifest.mouths)) {
      expect(html).toContain(`src="/avatars/keeper/${file}"`);
    }
    expect(html.match(/visibility:visible/g)).toHaveLength(1);
    expect(html).toMatch(
      /src="\/avatars\/keeper\/mouths\/REST\.png"[^>]*visibility:visible/,
    );
    expect(html).toContain('src="/avatars/keeper/lines/ts-keeper-001.m4a"');
    expect(html).toContain('data-letter="X"');
    expect(html).not.toContain("[pause");
    expect(html).toContain(
      "Hello, I am a placeholder voice. Watch my mouth move.",
    );
  });

  it("renders no caption or audio source for an unknown line", () => {
    const html = renderToStaticMarkup(
      createElement(TalkingAvatar, {
        manifest,
        lineId: "nope",
        baseUrl: "/avatars/keeper/",
      }),
    );
    expect(html).not.toContain("<figcaption");
    expect(html).not.toMatch(/<audio[^>]*src=/);
  });
});
