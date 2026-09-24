import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration suites each boot an in-memory Postgres (PGlite); running files
    // one at a time keeps memory usage predictable on small CI runners.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
      reporter: ['text', 'text-summary', 'lcov'],
    },
  },
});
