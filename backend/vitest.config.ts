import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    fileParallelism: false,
    globals: true,
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/composure_test',
    },
    setupFiles: ['tests/helpers/test-env.ts'],
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: [
      // Resolve .js imports to .ts source files
      { find: /^(.*)\.js$/, replacement: '$1.ts' },
    ],
  },
})
