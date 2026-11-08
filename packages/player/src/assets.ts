import { captionText, RHUBARB_LETTERS } from "@asset-studio/formats";

/** Resolves a manifest path (relative to the avatar folder) against `baseUrl`, e.g. `/avatars/keeper/`. */
export function assetUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return base + path.replace(/^(\.\/)+/, "");
}

/** The caption for a line: its text with `[pause N]` markup removed. */
export function captionFor(text: string): string {
  try {
    return captionText(text);
  } catch {
    // Malformed markup still never reaches the screen.
    return text
      .replace(/\[pause[^\]]*\]?/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

/** Distinct mouth files of a manifest, in letter order (B and H share one). */
export function mouthFiles(mouths: Readonly<Record<string, string>>): string[] {
  return [
    ...new Set(
      RHUBARB_LETTERS.map((letter) => mouths[letter]).filter(
        (path): path is string => path !== undefined,
      ),
    ),
  ];
}
