import { octane } from "octane/compiler/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [octane()],
  test: {
    environment: "happy-dom",
    include: ["packages/r-store/tests/octane/**/*.test.ts"],
    exclude: ["packages/r-store/tests/octane/**/*.ssr.test.ts"],
  },
});
