import {defineConfig} from 'vitest/config'
import {fileURLToPath} from 'node:url'

// Vitest for the scanner logic (and future suites). Node environment — the
// scanner core is pure functions over text; component tests can opt into jsdom
// per-file later. The `@/` alias mirrors tsconfig so imports match app code.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'components/**/*.test.{ts,tsx}'],
  },
})
