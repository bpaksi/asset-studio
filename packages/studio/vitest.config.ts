import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development", "import", "default"],
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
