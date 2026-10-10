import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/server/**/*.test.ts', 'apps/*/shared/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
