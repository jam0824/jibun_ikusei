import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['lambda/__tests__/**/*.test.mjs'],
  },
  resolve: {
    alias: {
      '/opt/nodejs/utils.mjs': path.resolve(__dirname, 'lambda/shared-layer/nodejs/utils.mjs'),
    },
  },
})
