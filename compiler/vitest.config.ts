import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: [
      { find: /^(.*)\.js$/, replacement: '$1.ts' },
    ],
  },
})
