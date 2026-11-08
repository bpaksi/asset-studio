import { derivedIds, type Job } from "@asset-studio/formats";

export type AssetKey = {
  /** Index key: the asset ID, or `<id>~<profile>` for a picture with 2+ profiles. */
  key: string;
  /** The asset ID the job knows (without the profile). */
  id: string;
  kind: string;
  /** The profile this key stands for; null for assets that have none. */
  profile: string | null;
  origin: "job" | "built";
};

/**
 * Every index key a job needs (P2 contract, Bob's ruling 2026-11-08): a
 * picture with two or more profiles gets one key per profile,
 * `<id>~<profile>`; a one-profile picture keeps its bare ID. Mood stills keep
 * `portrait.<speaker>~<mood>`. A glow mask follows its painting only when the
 * index already holds per-profile mask keys (`indexKeys`), otherwise it keeps
 * its bare ID. Switch to S5's exported helper once it merges.
 */
export function assetKeys(
  job: Job,
  indexKeys: ReadonlySet<string> = new Set(),
): AssetKey[] {
  const pictures = new Map(job.pictures.map((p) => [p.id, p]));
  const out: AssetKey[] = [];
  for (const derived of derivedIds(job)) {
    const picture = pictures.get(derived.id);
    if (
      derived.origin === "job" &&
      picture !== undefined &&
      picture.profiles.length >= 2
    ) {
      for (const profile of picture.profiles) {
        out.push({
          key: `${derived.id}~${profile}`,
          id: derived.id,
          kind: derived.kind,
          profile,
          origin: derived.origin,
        });
      }
      continue;
    }
    if (derived.kind === "glow") {
      const owner = job.pictures.find(
        (p) => p.profiles.length >= 2 && glowOf(p.id) === derived.id,
      );
      if (owner !== undefined) {
        const keyed = owner.profiles.filter((profile) =>
          indexKeys.has(`${derived.id}~${profile}`),
        );
        if (keyed.length > 0) {
          for (const profile of keyed) {
            out.push({
              key: `${derived.id}~${profile}`,
              id: derived.id,
              kind: derived.kind,
              profile,
              origin: derived.origin,
            });
          }
          continue;
        }
      }
    }
    out.push({
      key: derived.id,
      id: derived.id,
      kind: derived.kind,
      profile:
        picture?.profiles.length === 1 ? (picture.profiles[0] ?? null) : null,
      origin: derived.origin,
    });
  }
  return out;
}

/** `painting.stair` -> `glow.stair`. */
export function glowOf(pictureId: string): string | undefined {
  const dot = pictureId.indexOf(".");
  return dot === -1 ? undefined : `glow.${pictureId.slice(dot + 1)}`;
}
