import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import pkg from './package.json' with { type: 'json' }

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main/index.ts',
        onstart({ startup }) { if (!process.env.VSCODE_DEBUG) void startup(['.']) },
        vite: { build: {
          sourcemap: command === 'serve', minify: command === 'build',
          outDir: 'dist-electron/main',
          rolldownOptions: { external: Object.keys(pkg.dependencies) },
        } },
      },
      preload: {
        input: 'electron/preload/index.ts',
        onstart({ startup, reload }) {
          if (process.env.VSCODE_DEBUG) return
          if (process.electronApp) reload()
          else void startup(['.'])
        },
        vite: { build: {
          sourcemap: command === 'serve' ? 'inline' : false,
          outDir: 'dist-electron/preload',
          rolldownOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
        } },
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 3344, strictPort: true },
  build: { target: 'chrome152' },
  clearScreen: false,
}))
