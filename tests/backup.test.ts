import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, open } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { parseBackup, readBackup, serializeBackup, writeBackup, MAX_BACKUP_BYTES } from '../electron/main/backup'
import { BACKUP_FORMAT, BACKUP_MANIFEST_VERSION } from '../shared/backup'
import { DEFAULT_SHORTCUTS } from '../shared/shortcuts'
import { MAX_ITEM_BYTES, type ClipboardHistoryItem } from '../shared/clipboard'

const settings = { historyLimit: 250, paused: true, shortcuts: { ...DEFAULT_SHORTCUTS } }
const item = (id = 'text', data = 'Открытый текст <script>fixture</script>'): ClipboardHistoryItem => ({
  id, data, type: 'text', createdAt: 1700000000000,
  params: { type: 'text', size: '20 симв.', source: { name: 'Fixture', title: '' }, tags: [] },
})
const manifest = () => JSON.parse(serializeBackup([item()], settings, '2.0.0'))
const directories: string[] = []
async function fixturePath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clipclip-backup-'))
  directories.push(directory)
  return path.join(directory, 'history.json')
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

describe('JSON backup manifest', () => {
  it('round-trips paste behavior and defaults legacy backups to enabled', () => {
    const text = serializeBackup([], { ...settings, pasteOnSelect: false }, '2.0.0')
    expect(parseBackup(text).settings.pasteOnSelect).toBe(false)
    const legacy = JSON.parse(text)
    delete legacy.settings.pasteOnSelect
    expect(parseBackup(JSON.stringify(legacy)).settings.pasteOnSelect).toBe(true)
    legacy.settings.pasteOnSelect = 'false'
    expect(() => parseBackup(JSON.stringify(legacy))).toThrow()
  })
  it('round-trips history promotion and validates the optional legacy setting', () => {
    const text = serializeBackup([], { ...settings, promoteCopiedRecords: false }, '2.0.0')
    expect(parseBackup(text).settings.promoteCopiedRecords).toBe(false)
    const legacy = JSON.parse(text)
    delete legacy.settings.promoteCopiedRecords
    expect(parseBackup(JSON.stringify(legacy)).settings.promoteCopiedRecords).toBe(true)
    legacy.settings.promoteCopiedRecords = 'false'
    expect(() => parseBackup(JSON.stringify(legacy))).toThrow('Некорректная структура')
  })
  it('imports legacy shortcuts without discarding existing custom bindings', () => {
    const value = manifest()
    delete value.settings.shortcuts.showFavorites
    delete value.settings.shortcuts.openSettings
    value.settings.shortcuts.openWindow = 'Ctrl+Shift+Q'
    expect(parseBackup(JSON.stringify(value)).settings.shortcuts).toEqual({ ...DEFAULT_SHORTCUTS, openWindow: 'Ctrl+Shift+Q' })
  })
  it('preserves the time format and defaults older v1 backups to 24-hour time', () => {
    const text = serializeBackup([], { ...settings, timeFormat: '12h' }, '2.0.0')
    expect(parseBackup(text).settings.timeFormat).toBe('12h')
    const legacy = JSON.parse(text)
    delete legacy.settings.timeFormat
    expect(parseBackup(JSON.stringify(legacy)).settings.timeFormat).toBe('24h')
    legacy.settings.timeFormat = 'invalid'
    expect(() => parseBackup(JSON.stringify(legacy))).toThrow('Некорректная структура')
  })
  it('round-trips plaintext, image data, file references, favorites and settings with one format version', () => {
    const image: ClipboardHistoryItem = { ...item('image', 'data:image/png;base64,' + readFileSync(new URL('../public/notepad.png', import.meta.url)).toString('base64')), type: 'image', params: { ...item().params, type: 'image' } }
    const file: ClipboardHistoryItem = { ...item('files', 'C:\\fixture'), type: 'file', fileUris: ['file:///C:/fixture'], fileKinds: ['folder'], params: { ...item().params, type: 'file' } }
    const records = [{ ...item(), pinned: true }, image, file, { ...item('path', 'C:\\fixture.pdf'), textOrigin: 'file-path' as const }]
    const text = serializeBackup(records, settings, '2.0.0')
    expect(text).toContain('Открытый текст <script>fixture</script>')
    expect(JSON.parse(text)).toMatchObject({ format: BACKUP_FORMAT, manifestVersion: BACKUP_MANIFEST_VERSION, appVersion: '2.0.0' })
    expect(parseBackup(text)).toMatchObject({ settings, history: records })
    const nextApp = JSON.parse(text); nextApp.appVersion = '3.5.0'
    expect(parseBackup('\uFEFF' + JSON.stringify(nextApp)).appVersion).toBe('3.5.0')
  })
  it('ignores extension fields in v1 and copies only known fields', () => {
    const value = manifest()
    value.extension = { enabled: true }; value.history[0].extension = 'unused'
    value.settings.shortcuts.extra = 'extension'; value.history[0].params.extension = true
    const parsed = parseBackup(JSON.stringify(value))
    expect(parsed).not.toHaveProperty('extension')
    expect(parsed.history[0]).not.toHaveProperty('extension')
    expect(parsed.history[0].params).not.toHaveProperty('extension')
    expect(parsed.settings.shortcuts).not.toHaveProperty('extra')
  })
  it.each([undefined, 0, 2, '1', null])('rejects unsupported manifest version %s', version => {
    const value = manifest(); value.manifestVersion = version
    expect(() => parseBackup(JSON.stringify(value))).toThrow('Версия манифеста')
  })
  it.each(['{', '[]', 'null', '{"format":"another-app"}'])('rejects corrupt or unrelated JSON', text => {
    expect(() => parseBackup(text)).toThrow()
  })
  it.each([
    (value: ReturnType<typeof manifest>) => { value.settings.historyLimit = 0 },
    (value: ReturnType<typeof manifest>) => { value.settings.paused = 'false' },
    (value: ReturnType<typeof manifest>) => { value.settings.shortcuts.copySelected = 'Ctrl+D' },
    (value: ReturnType<typeof manifest>) => { value.history[0].data = 25 },
    (value: ReturnType<typeof manifest>) => { value.history[0].fileUris = ['https://example.com/file'] },
    (value: ReturnType<typeof manifest>) => { value.history[0].params.source = null },
    (value: ReturnType<typeof manifest>) => { value.exportedAt = 'invalid' },
  ])('rejects invalid settings and items before import', mutate => {
    const value = manifest(); mutate(value)
    expect(() => parseBackup(JSON.stringify(value))).toThrow()
  })
  it('enforces UTF-8 item and total history byte limits', () => {
    const value = manifest(); value.history[0].data = 'я'.repeat(MAX_ITEM_BYTES / 2 + 1)
    expect(() => parseBackup(JSON.stringify(value))).toThrow('Превышен')
    value.history = Array.from({ length: 5 }, (_, index) => item(String(index), 'a'.repeat(MAX_ITEM_BYTES)))
    expect(() => parseBackup(JSON.stringify(value))).toThrow('Превышен')
  })
  it('writes readable UTF-8 JSON and replaces an existing destination without leftover temporary files', async () => {
    const file = await fixturePath()
    await writeFile(file, 'old backup')
    await writeBackup(file, serializeBackup([item()], settings, '2.0.0'))
    expect(await readBackup(file)).toMatchObject({ history: [item()], settings })
    expect(await readFile(file, 'utf8')).toContain('"manifestVersion": 1')
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(path.dirname(file))).toEqual(['history.json'])
  })
  it('rejects oversized files before reading their contents', async () => {
    const file = await fixturePath()
    const handle = await open(file, 'w')
    await handle.truncate(MAX_BACKUP_BYTES + 1); await handle.close()
    await expect(readBackup(file)).rejects.toThrow('256 МБ')
  })
})
