// Test support: `node --import this-file` lets a plain node process run the
// workspace's TypeScript sources (see e2e-hooks.mjs).
import { register } from "node:module";

register("./e2e-hooks.mjs", import.meta.url);
