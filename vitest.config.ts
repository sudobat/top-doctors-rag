import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Los tests de BD comparten la base rag_test.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
