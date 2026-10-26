import { readFileSync, readdirSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'

// Resolve from the importing package so nested dependency versions keep their own notices.
export function licensePlugin(root: string): Plugin {
  const id = 'virtual:clipclip-licenses'
  const electronNotices = path.join(root, 'node_modules/electron/dist/LICENSES.chromium.html')
  return {
    name: 'clipclip-licenses',
    resolveId(source) { if (source === id) return '\0' + id },
    configureServer(server) {
      server.middlewares.use('/@clipclip/electron-notices', (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(readFileSync(electronNotices))
      })
    },
    load(source) {
      if (source !== '\0' + id) return
      const components: { name: string; version: string; license: string; text: string }[] = []
      const visited = new Set<string>()
      const visit = (name: string, from: string, optional = false) => {
        if (isBuiltin(name)) return
        const require = createRequire(path.join(from, 'package.json'))
        let directory: string
        try {
          directory = (require.resolve.paths(name) ?? []).map(base => path.join(base, name))
            .find(candidate => { try { readFileSync(path.join(candidate, 'package.json')); return true } catch { return false } })!
          if (!directory) throw new Error(`Cannot resolve ${name}`)
        } catch (error) { if (optional) return; throw error }
        if (visited.has(directory)) return
        visited.add(directory)
        const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
        const files = readdirSync(directory).filter(file => /^(licen[cs]e|copying|notice)(\.|$)/i.test(file)).sort()
        let text = files.map(file => readFileSync(path.join(directory, file), 'utf8').trim()).join('\n\n')
        if (!text) {
          const readme = readdirSync(directory).find(file => /^readme(\.md)?$/i.test(file))
          const content = readme ? readFileSync(path.join(directory, readme), 'utf8') : ''
          const heading = /(?:^|\n)#{0,6}\s*(?:license|copyright)(?:\s*\([^\n]+\))?\s*\n/i.exec(content)
          if (heading) text = content.slice(heading.index).trim()
        }
        if (!text && name.startsWith('@koromix/koffi-')) {
          text = readFileSync(path.join(root, 'node_modules/koffi/LICENSE.txt'), 'utf8')
        }
        if (!text) text = `Лицензия: ${pkg.license ?? 'не указана'}.\nАвтор: ${typeof pkg.author === 'object' ? pkg.author.name : pkg.author ?? 'не указан'}.\nОтдельный текст лицензии отсутствует в поставке пакета.\n${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? ''}`
        if (!components.some(component => component.name === pkg.name && component.version === pkg.version)) {
          components.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? 'См. текст лицензии', text })
        }
        // Electron's runtime notices are distributed separately; npm dependencies only install it.
        if (name === 'electron') return
        for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, directory)
        for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) visit(dependency, directory, true)
      }
      const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      const roots = [...Object.keys(pkg.dependencies), 'electron', 'vue', 'pinia', 'vue-router', '@mdi/js', 'tailwindcss']
      roots.forEach(name => visit(name, root))
      components.push({ name: 'Шаблон electron-vite-vue', version: '', license: 'MIT',
        text: readFileSync(path.join(root, 'build/license-notices/electron-vite-vue-template.txt'), 'utf8') })
      components.sort((a, b) => a.name.localeCompare(b.name))
      const noticesUrl = this.environment.config.command === 'build'
        ? `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: 'asset', name: 'electron-notices.txt', source: readFileSync(electronNotices) })}`
        : JSON.stringify('/@clipclip/electron-notices')
      return `export default ${JSON.stringify({ version: pkg.version, author: pkg.author,
        license: pkg.license, appLicense: readFileSync(path.join(root, 'LICENSE'), 'utf8'), components })};\nexport const electronNoticesUrl = ${noticesUrl};`
    },
  }
}
