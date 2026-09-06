import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/integration/server-only-shim.ts", import.meta.url)),
    },
  },
  test: {
    root: projectRoot,
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    isolate: true,
  },
});
