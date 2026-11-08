import { readFileSync } from "node:fs";
import { jobSchema } from "@asset-studio/formats";
import { describe, expect, it } from "vitest";

import { assetKeys } from "./keys.js";
import { JOB_FIXTURE } from "./testing/workspace.js";

const job = jobSchema.parse(JSON.parse(readFileSync(JOB_FIXTURE, "utf8")));

describe("assetKeys (multi-profile key rule)", () => {
  it("gives a 2+ profile picture one key per profile and a 1-profile picture its bare ID", () => {
    const keys = assetKeys(job).map((k) => k.key);
    expect(keys).toContain("painting.stair");
    expect(keys).toContain("foe.shade~dashboard");
    expect(keys).toContain("foe.shade~ipad");
    expect(keys).not.toContain("foe.shade");
  });

  it("keeps mood stills, lines, sounds and the glow mask as the job derives them", () => {
    expect(assetKeys(job).map((k) => k.key)).toEqual([
      "portrait.narrator",
      "portrait.narrator~angry",
      "portrait.bystander",
      "portrait.bystander~scared",
      "scene-a.02~vo-01",
      "painting.stair",
      "glow.stair",
      "foe.shade~dashboard",
      "foe.shade~ipad",
      "sound.door",
    ]);
  });
});
