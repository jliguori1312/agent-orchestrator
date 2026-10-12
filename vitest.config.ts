// vitest.config.ts — test runner configuration.
// Tests import describe/it/expect from 'vitest' explicitly (no globals), so
// the config stays minimal and the linter can flag unused imports.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
