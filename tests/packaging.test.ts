import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const packages = ["formats", "cli", "player"] as const;
const published = ["formats", "player"] as const;

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
      if (name === "cli") {
        expect(manifest.publishConfig?.access).toBeUndefined();
      } else {
        expect(manifest.publishConfig?.access).toBe("public");
      }
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

  it("releases formats and player at 0.2.0 and keeps the cli private", () => {
    for (const name of published) {
      const manifest = readJson(
        resolve(root, "packages", name, "package.json"),
      );
      expect(manifest.version, name).toBe("0.2.0");
      expect(manifest.private, name).not.toBe(true);
      expect(manifest.repository, name).toEqual({
        type: "git",
        url: "git+https://github.com/bpaksi/asset-studio.git",
        directory: `packages/${name}`,
      });
    }
    const cli = readJson(resolve(root, "packages/cli/package.json"));
    expect(cli.private).toBe(true);
    expect(cli.publishConfig?.access).toBeUndefined();
    const player = readJson(resolve(root, "packages/player/package.json"));
    expect(player.dependencies?.["@asset-studio/formats"]).toBe("workspace:*");
    // Bloodtower runs React 19.3.0.
    expect(player.peerDependencies?.react).toBe("^18.0.0 || ^19.0.0");
    expect(player.dependencies?.react).toBeUndefined();
  });

  it("publishes formats then player via OIDC, never from a tag push", () => {
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
    expect(release).toContain(
      "for pkg in packages/formats packages/player; do",
    );
    expect(release).not.toContain("packages/cli");
    expect(release).toContain("pack --pack-destination");
    expect(release).toContain(
      `if npm view "\${name}@\${ver}" version >/dev/null 2>&1; then`,
    );
    expect(release).toContain('npm publish "$pkgdest"/*.tgz');
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
