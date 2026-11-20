import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FileChecker } from '../electron/main/files'
import { filePathLabel, fileSummary } from '../shared/files'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(actual.stat) }
})

let directory: string
const uri = (name: string) => pathToFileURL(path.join(directory, name)).href
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(fs.stat).mockReset().mockImplementation(actual.stat)
  directory = await fs.mkdtemp(path.join(tmpdir(), 'clipclip-files-test-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('file availability before clipboard writes', () => {
  it('probes only the selected path in a group', async () => {
    await fs.mkdir(path.join(directory, 'selected'))
    const choices = [uri('another file'), uri('selected')]
    const checker = new FileChecker()
    await expect(checker.checkPath(choices, 1)).resolves.toEqual({
      status: 'available', message: 'Выбранный путь доступен.', kinds: ['folder'],
    })
    expect(fs.stat).toHaveBeenCalledExactlyOnceWith(path.join(directory, 'selected'))
    expect(() => checker.checkPath(choices, 2)).toThrow('Некорректный путь')
    expect(fs.stat).toHaveBeenCalledTimes(1)
  })
  it('copies a mixed list of arbitrary files, Unicode names and directories', async () => {
    await fs.writeFile(path.join(directory, 'Архив #1.zip'), 'synthetic')
    await fs.writeFile(path.join(directory, 'app.exe'), 'synthetic')
    await fs.mkdir(path.join(directory, 'folder'))
    const write = vi.fn(async () => {})
    const result = await new FileChecker().copy([uri('Архив #1.zip'), uri('app.exe'), uri('folder')], write)
    expect(result.status).toBe('available')
    expect(result.kinds).toEqual(['file', 'file', 'folder'])
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('leaves the clipboard untouched when even one file or folder is missing', async () => {
    await fs.writeFile(path.join(directory, 'existing.zip'), 'synthetic')
    const write = vi.fn(async () => {})
    const result = await new FileChecker().copy([uri('existing.zip'), uri('missing folder')], write)
    expect(result.status).toBe('missing')
    expect(result.message).toContain('missing folder')
    expect(write).not.toHaveBeenCalled()
  })
  it('rechecks after deletion and allows a restored file on the next attempt', async () => {
    const checker = new FileChecker()
    const file = path.join(directory, 'file.zip')
    const uris = [uri('file.zip')]
    await fs.writeFile(file, 'synthetic')
    expect((await checker.check(uris)).status).toBe('available')
    await fs.unlink(file)
    const write = vi.fn(async () => {})
    expect((await checker.copy(uris, write)).status).toBe('missing')
    expect(write).not.toHaveBeenCalled()
    await fs.writeFile(file, 'restored')
    expect((await checker.copy(uris, write)).status).toBe('available')
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('distinguishes lack of access from a deleted file', async () => {
    vi.mocked(fs.stat).mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))
    const write = vi.fn(async () => {})
    const result = await new FileChecker().copy([uri('private')], write)
    expect(result.status).toBe('unavailable')
    expect(result.message).toContain('права доступа')
    expect(write).not.toHaveBeenCalled()
  })
  it('times out without copying and bounds work on a stalled drive across retries', async () => {
    vi.useFakeTimers()
    const probe = vi.mocked(fs.stat).mockImplementation(() => new Promise(() => {}))
    const checker = new FileChecker()
    const uris = Array.from({ length: 100 }, (_, index) => uri('stalled-' + index))
    const write = vi.fn(async () => {})
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = checker.copy(uris, write)
      await vi.advanceTimersByTimeAsync(1500)
      expect((await result).status).toBe('unavailable')
    }
    expect(probe).toHaveBeenCalledTimes(8)
    expect(write).not.toHaveBeenCalled()
  })
  it('rejects unsupported URI schemes before filesystem access', async () => {
    const probe = vi.mocked(fs.stat)
    await expect(new FileChecker().check(['https://example.test/a.zip'])).rejects.toThrow()
    expect(probe).not.toHaveBeenCalled()
  })
  it('reveals the selected directory itself and does not execute or open other files', async () => {
    await fs.mkdir(path.join(directory, 'folder'))
    const show = vi.fn()
    const checker = new FileChecker()
    expect((await checker.reveal([uri('missing.zip'), uri('folder')], 1, show)).status).toBe('available')
    expect(show).toHaveBeenCalledExactlyOnceWith(path.join(directory, 'folder'))
    show.mockClear()
    expect((await checker.reveal([uri('missing.zip')], 0, show)).status).toBe('missing')
    expect(show).not.toHaveBeenCalled()
    for (const index of [-1, .5, 1, NaN]) await expect(checker.reveal([uri('folder')], index, show)).rejects.toThrow()
    await expect(checker.reveal(['https://example.test'], 0, show)).rejects.toThrow()
  })
  it('formats Windows, network and Unicode paths and file/folder counts', () => {
    expect(filePathLabel('file:///C:/Docs/%D0%A4%D0%B0%D0%B9%D0%BB%20%231.zip')).toBe('C:\\Docs\\Файл #1.zip')
    expect(filePathLabel('file://server/share/folder')).toBe('\\\\server\\share\\folder')
    expect(fileSummary(['folder'])).toBe('1 папка')
    expect(fileSummary(['file', 'folder'])).toBe('1 файл, 1 папка')
    expect(fileSummary(Array(12).fill('folder'))).toBe('12 папок')
    expect(fileSummary(['unknown'])).toBe('1 объект')
  })
})
