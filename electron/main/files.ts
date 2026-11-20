import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isFileUriList, type FileCheckResult, type FileKind } from '../../shared/clipboard'

const TIMEOUT_MS = 1500
type FileStatus = FileCheckResult['status']

// Bound filesystem work even if a disconnected network drive outlives our timeout.
export class FileChecker {
  private active = 0

  private async probe(uri: string): Promise<{ status: FileStatus; kind: FileKind }> {
    if (this.active >= 8) return { status: 'unavailable', kind: 'unknown' }
    this.active++
    try {
      const info = await stat(fileURLToPath(uri))
      const kind = info.isDirectory() ? 'folder' : info.isFile() ? 'file' : 'unknown'
      return { status: kind === 'unknown' ? 'unavailable' : 'available', kind }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return { status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable', kind: 'unknown' }
    } finally { this.active-- }
  }

  async check(uris: string[], single = false): Promise<FileCheckResult> {
    if (!isFileUriList(uris)) throw new Error('Некорректный список файлов.')
    let next = 0
    let expired = false
    const missing: string[] = []
    const kinds: FileKind[] = uris.map(() => 'unknown')
    let unavailable = false
    const worker = async () => {
      while (!expired && next < uris.length) {
        const index = next++
        const uri = uris[index]
        const { status, kind } = await this.probe(uri)
        kinds[index] = kind
        if (status === 'missing') missing.push(uri)
        if (status === 'unavailable') unavailable = true
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<FileCheckResult>(resolve => {
      timer = setTimeout(() => {
        expired = true
        resolve({ status: 'unavailable', kinds: [...kinds], message: `Проверка ${single ? 'пути' : 'файлов'} заняла слишком много времени. Проверьте подключение к диску и повторите попытку.` })
      }, TIMEOUT_MS)
    })
    const checked = Promise.all(Array.from({ length: Math.min(4, uris.length) }, worker)).then((): FileCheckResult => {
      if (missing.length) {
        const names = missing.slice(0, 3).map(uri => decodeURIComponent(new URL(uri).pathname).split('/').filter(Boolean).at(-1)).join(', ')
        return { status: 'missing', kinds: [...kinds], message: `Файл или папка больше не существует: ${names}${missing.length > 3 ? ` и ещё ${missing.length - 3}` : ''}.${single ? '' : ' Копирование списка невозможно.'}` }
      }
      return unavailable
        ? { status: 'unavailable', kinds: [...kinds], message: `Не удалось проверить доступность ${single ? 'выбранного пути' : 'всех файлов и папок'}. Проверьте права доступа и подключение к диску.` }
        : { status: 'available', kinds: [...kinds], message: single ? 'Выбранный путь доступен.' : 'Все файлы и папки доступны.' }
    })
    try { return await Promise.race([checked, timeout]) }
    finally { clearTimeout(timer) }
  }

  async copy(uris: string[], write: () => Promise<void>): Promise<FileCheckResult> {
    const result = await this.check(uris)
    if (result.status === 'available') await write()
    return result
  }

  checkPath(uris: string[], index: number): Promise<FileCheckResult> {
    if (!isFileUriList(uris) || !Number.isInteger(index) || index < 0 || index >= uris.length) throw new Error('Некорректный путь записи.')
    return this.check([uris[index]], true)
  }

  async reveal(uris: string[], index: number, show: (path: string) => void): Promise<FileCheckResult> {
    const result = await this.checkPath(uris, index)
    if (result.status === 'available') show(fileURLToPath(uris[index]))
    return { status: result.status, message: result.message + (result.status === 'missing' ? ' Открытие в Проводнике невозможно.' : '') }
  }
}
