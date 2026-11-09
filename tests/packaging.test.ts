import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const packages = ["formats", "player", "cli", "studio"] as const;
const VERSION = "0.2.2";

type Manifest = {
  version?: string;
  private?: boolean;
  license?: string;
  packageManager?: string;
  files?: string[];
  types?: string;
  exports?: unknown;
  repository?: {
    type?: string;
    url?: string;
    directory?: string;
  };
  publishConfig?: {
    access?: string;
    types?: string;
    exports?: unknown;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readJson(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function assertExactVersions(
  versions: Record<string, string> | undefined,
): void {
  for (const [name, version] of Object.entries(versions ?? {})) {
    const workspaceLink = version.startsWith("workspace:");
    expect(
      version.includes("^") || version.includes("~"),
      `${name}@${version}`,
    ).toBe(false);
    expect(workspaceLink || /^[0-9]/.test(version), `${name}@${version}`).toBe(
      true,
    );
  }
}

describe("npm packaging", () => {
  it("keeps the workspace root private and pins pnpm", () => {
    const manifest = readJson(resolve(root, "package.json"));
    expect(manifest.private).toBe(true);
    expect(manifest.license).toBe("MIT");
    expect(manifest.packageManager).toBe("pnpm@10.33.4");
    expect(existsSync(resolve(root, "pnpm-lock.yaml"))).toBe(true);
    expect(existsSync(resolve(root, "pnpm-workspace.yaml"))).toBe(true);
    assertExactVersions(manifest.devDependencies);
  });

  it("publishes each package with exports, types, files, and the MIT license", () => {
    const license = readFileSync(resolve(root, "LICENSE"));
    for (const name of packages) {
      const dir = resolve(root, "packages", name);
      const manifest = readJson(resolve(dir, "package.json"));
      expect(manifest.license).toBe("MIT");
      expect(manifest.files).toEqual(["dist", "LICENSE"]);
      expect(manifest.types).toBe("./dist/index.d.ts");
      expect(manifest.private).not.toBe(true);
      expect(manifest.publishConfig?.access).toBe("public");
      expect(manifest.publishConfig?.types).toBe("./dist/index.d.ts");
      expect(JSON.stringify(manifest.publishConfig?.exports)).not.toContain(
        "development",
      );
      expect(JSON.stringify(manifest.publishConfig?.exports)).not.toContain(
        "src",
      );
      expect(JSON.stringify(manifest.publishConfig?.exports)).toContain(
        "./dist/index.d.ts",
      );
      expect(JSON.stringify(manifest.publishConfig?.exports)).toContain(
        "./dist/index.js",
      );
      expect(readFileSync(resolve(dir, "LICENSE"))).toEqual(license);
      assertExactVersions(manifest.dependencies);
      assertExactVersions(manifest.devDependencies);
    }
  });

  it("releases all four packages at one version, public, with a repository", () => {
    for (const name of packages) {
      const manifest = readJson(
        resolve(root, "packages", name, "package.json"),
      );
      expect(manifest.version, name).toBe(VERSION);
      expect(manifest.private, name).not.toBe(true);
      expect(manifest.repository, name).toEqual({
        type: "git",
        url: "git+https://github.com/bpaksi/asset-studio.git",
        directory: `packages/${name}`,
      });
    }
    const cli = readJson(resolve(root, "packages/cli/package.json"));
    expect(cli.dependencies?.sharp).toBeDefined();
    expect(cli.dependencies?.["@asset-studio/studio"]).toBeUndefined();
    expect(cli.peerDependencies?.["@asset-studio/studio"]).toBeUndefined();
    const studio = readJson(resolve(root, "packages/studio/package.json"));
    expect(studio.dependencies?.["@asset-studio/cli"]).toBe("workspace:*");
    expect(studio.dependencies?.["@asset-studio/formats"]).toBe("workspace:*");
    const player = readJson(resolve(root, "packages/player/package.json"));
    expect(player.dependencies?.["@asset-studio/formats"]).toBe("workspace:*");
    // Bloodtower runs React 19.3.0.
    expect(player.peerDependencies?.react).toBe("^18.0.0 || ^19.0.0");
    expect(player.dependencies?.react).toBeUndefined();
  });

  it("publishes formats, player, cli, studio via OIDC, never from a tag push", () => {
    const release = readFileSync(
      resolve(root, ".github/workflows/release.yml"),
      "utf8",
    );
    const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
    expect(release).toContain("version: 10.33.4");
    expect(release).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(release).not.toMatch(/^\s*(push|tags|pull_request|release):/m);
    expect(release).not.toContain('"v*"');
    expect(release).toContain("id-token: write");
    expect(release).toContain("contents: read");
    expect(release).toContain("if: github.ref == 'refs/heads/main'");
    expect(release).toContain("actions/setup-node@v6");
    expect(release).toContain("registry-url: https://registry.npmjs.org");
    expect(release).toContain("npm@11.5.1");
    expect(release).toContain(
      "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$",
    );
    expect(
      release.split(
        "for pkg in packages/formats packages/player packages/cli packages/studio; do",
      ).length - 1,
    ).toBe(3);
    expect(release).toContain("is already on npm");
    expect(release).toContain("E404");
    expect(
      release.indexOf("playwright install --with-deps chromium"),
    ).toBeGreaterThan(-1);
    expect(
      release.indexOf("playwright install --with-deps chromium"),
    ).toBeLessThan(release.indexOf("- run: pnpm check"));
    expect(release).toContain("node scripts/smoke-pack.mjs");
    expect(release).toContain("pack --pack-destination");
    expect(release).toContain(
      `if view="$(npm view "\${name}@\${ver}" version 2>&1)"; then`,
    );
    expect(release).toContain("npm publish ");
    expect(release).toContain("--access public --provenance");
    expect(release).toContain("--provenance");
    expect(release).not.toContain("pnpm -r run build");
    expect(release).not.toContain("NODE_AUTH_TOKEN");
    expect(release).not.toContain("NPM_TOKEN");
    expect(release).not.toContain("pnpm -r publish");
    expect(ci).toContain("pnpm install --frozen-lockfile");
    expect(ci).toContain("pnpm lint");
    expect(ci).toContain("pnpm typecheck");
    expect(ci).toContain("pnpm test");
  });

  it("keeps use client on the player package entry in src and dist", () => {
    const src = readFileSync(
      resolve(root, "packages/player/src/index.ts"),
      "utf8",
    );
    expect(src.startsWith('"use client";')).toBe(true);
    const distPath = resolve(root, "packages/player/dist/index.js");
    // Dist is produced by typecheck/build. `pnpm check` builds first; a
    // bare `pnpm test` on a clean tree has no dist yet.
    if (!existsSync(distPath)) {
      return;
    }
    const dist = readFileSync(distPath, "utf8");
    expect(/^["']use client["'];/.test(dist)).toBe(true);
  });
});
