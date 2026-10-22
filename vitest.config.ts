import { defineConfig } from "vitest/config";
export default defineConfig({
  // every server test file starts its own in-memory PostgreSQL (WASM): too many at once starve each other on a laptop (hook timeouts), so the number of workers is capped
  test: { include: ["packages/*/test/**/*.test.ts", "server/test/**/*.test.ts", "app/test/**/*.test.ts"], testTimeout: 60000, hookTimeout: 120000, poolOptions: { threads: { maxThreads: 5, minThreads: 1 }, forks: { maxForks: 5, minForks: 1 } } },
});
