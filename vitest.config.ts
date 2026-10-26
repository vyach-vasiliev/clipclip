import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { licensePlugin } from './build/licenses.ts'
export default defineConfig({
  plugins: [vue(), licensePlugin(fileURLToPath(new URL('.', import.meta.url)))],
  test: { include: ['tests/**/*.test.ts'], environment: 'node', restoreMocks: true },
})
