import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Serves the Keeper fixture from @asset-studio/formats at /keeper/.
// `pnpm example --host` exposes it on the LAN for an iPad.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../formats/fixtures", import.meta.url)),
  oxc: { jsx: { runtime: "automatic" } },
});
