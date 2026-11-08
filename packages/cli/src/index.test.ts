import { describe, expect, it } from "vitest";

import { dialogFileText, ttsRequests } from "./index.js";

describe("@asset-studio/cli", () => {
  it("asks TTS for spoken segments and strips pause markup from the dialog file", () => {
    const line = "Welcome. [pause 0.5] Follow me.";
    expect(
      ttsRequests(line, { voiceId: "voice-1", style: "calm, warm" }).map(
        (request) => request.text,
      ),
    ).toEqual(["Welcome.", "Follow me."]);
    expect(dialogFileText(line)).toBe("Welcome. Follow me.");
  });
});
