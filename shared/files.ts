import type { FileKind } from './clipboard'

export function filePathLabel(uri: string): string {
  const url = new URL(uri)
  const path = decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:\/)/, '')
  if (url.hostname) return '\\\\' + url.hostname + path.replaceAll('/', '\\')
  return /^[A-Za-z]:\//.test(path) ? path.replaceAll('/', '\\') : path
}

function plural(count: number, forms: [string, string, string]) {
  const last = count % 10, pair = count % 100
  return `${count} ${forms[pair >= 11 && pair <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2]}`
}

export function fileSummary(kinds: FileKind[]): string {
  return (['file', 'folder', 'unknown'] as const).map(kind => {
    const count = kinds.filter(value => value === kind).length
    const forms: [string, string, string] = kind === 'file' ? ['файл', 'файла', 'файлов']
      : kind === 'folder' ? ['папка', 'папки', 'папок'] : ['объект', 'объекта', 'объектов']
    return count ? plural(count, forms) : ''
  }).filter(Boolean).join(', ')
}
