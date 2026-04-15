import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    fileParallelism: false,
    globals: true,
    env: {
      NODE_ENV: 'test',
    },
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
