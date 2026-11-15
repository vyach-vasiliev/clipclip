import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'

// About lists direct components; package dependencies retain their own distributed notices.
export function licensePlugin(root: string): Plugin {
  const id = 'virtual:clipclip-licenses'
  const require = createRequire(path.join(root, 'package.json'))
  return {
    name: 'clipclip-licenses',
    resolveId(source) { if (source === id) return '\0' + id },
    load(source) {
      if (source !== '\0' + id) return
      const components: { name: string; version: string; license: string; text: string }[] = []
      const visit = (name: string) => {
        let directory: string
        try {
          directory = (require.resolve.paths(name) ?? []).map(base => path.join(base, name))
            .find(candidate => { try { readFileSync(path.join(candidate, 'package.json')); return true } catch { return false } })!
          if (!directory) throw new Error(`Cannot resolve ${name}`)
        } catch (error) { throw new Error(`Cannot load license for ${name}`, { cause: error }) }
        const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
        const files = readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && /^(licen[cs]e|copying|notice)(\.|$)/i.test(file.name)).map(file => file.name).sort()
        let text = files.map(file => readFileSync(path.join(directory, file), 'utf8').trim()).join('\n\n')
        if (!text) {
          const readme = readdirSync(directory).find(file => /^readme(\.md)?$/i.test(file))
          const content = readme ? readFileSync(path.join(directory, readme), 'utf8') : ''
          const heading = /(?:^|\n)#{0,6}\s*(?:license|copyright)(?:\s*\([^\n]+\))?\s*\n/i.exec(content)
          if (heading) text = content.slice(heading.index).trim()
        }
        if (!text) text = `Лицензия: ${pkg.license ?? 'не указана'}.\nАвтор: ${typeof pkg.author === 'object' ? pkg.author.name : pkg.author ?? 'не указан'}.\nОтдельный текст лицензии отсутствует в поставке пакета.\n${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? ''}`
        if (!components.some(component => component.name === pkg.name && component.version === pkg.version)) {
          components.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? 'См. текст лицензии', text })
        }
      }
      const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      const roots = [...Object.keys(pkg.dependencies), 'electron', 'vue', 'pinia', 'vue-router', '@mdi/js', 'tailwindcss']
      roots.forEach(visit)
      components.sort((a, b) => a.name.localeCompare(b.name))
      if (this.environment.config.command === 'build') {
        this.emitFile({ type: 'asset', name: 'template-license.txt',
          source: readFileSync(path.join(root, 'build/license-notices/electron-vite-vue-template.txt')) })
      }
      return `export default ${JSON.stringify({ version: pkg.version, author: pkg.author,
        license: pkg.license, appLicense: readFileSync(path.join(root, 'LICENSE'), 'utf8'), components })};`
    },
  }
}
