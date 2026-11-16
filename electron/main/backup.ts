import { randomUUID } from 'node:crypto'
import { open, rename, unlink, writeFile } from 'node:fs/promises'
import { BACKUP_FORMAT, BACKUP_MANIFEST_VERSION, type BackupManifest, type BackupSettings } from '../../shared/backup'
import { isHistoryItem, isHistoryLimit, MAX_HISTORY_BYTES, MAX_HISTORY_LIMIT, MAX_ITEM_BYTES, type ClipboardHistoryItem } from '../../shared/clipboard'
import { DEFAULT_SHORTCUTS, shortcutError, type ShortcutSettings } from '../../shared/shortcuts'
import { DEFAULT_TIME_FORMAT, isTimeFormat } from '../../shared/time'

export const MAX_BACKUP_BYTES = 256 * 1024 * 1024

export class BackupError extends Error {}

// Copy known fields only: extension fields in a supported manifest are ignored.
function cleanItem(item: ClipboardHistoryItem): ClipboardHistoryItem {
  return {
    id: item.id, type: item.type, data: item.data, createdAt: item.createdAt,
    ...(item.pinned !== undefined ? { pinned: item.pinned } : {}),
    ...(item.fileUris ? { fileUris: [...item.fileUris] } : {}),
    ...(item.fileKinds ? { fileKinds: [...item.fileKinds] } : {}),
    ...(item.textOrigin ? { textOrigin: item.textOrigin } : {}),
    params: { size: item.params.size, type: item.params.type,
      source: { name: item.params.source.name, title: item.params.source.title },
      tags: item.params.tags.map(tag => ({ code: tag.code, value: tag.value })) },
  }
}

export function parseBackup(text: string): BackupManifest {
  if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) throw new BackupError('Файл JSON больше 256 МБ.')
  let value: unknown
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new BackupError('Не удалось прочитать JSON. Файл повреждён или имеет другой формат.') }
  if (!value || typeof value !== 'object') throw new BackupError('Это не файл экспорта ClipClip.')
  const manifest = value as BackupManifest
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError('Это не файл экспорта ClipClip.')
  if (manifest.manifestVersion !== BACKUP_MANIFEST_VERSION) throw new BackupError('Версия манифеста не поддерживается. Обновите ClipClip или выберите файл с manifestVersion: 1.')
  const settings = manifest.settings
  const shortcuts = settings?.shortcuts && typeof settings.shortcuts === 'object' && !Array.isArray(settings.shortcuts)
    ? Object.fromEntries(Object.keys(DEFAULT_SHORTCUTS).map(key => [key, settings.shortcuts[key as keyof ShortcutSettings]])) as ShortcutSettings : null
  if (typeof manifest.appVersion !== 'string' || manifest.appVersion.length > 100
    || typeof manifest.exportedAt !== 'string' || manifest.exportedAt.length > 100 || !Number.isFinite(Date.parse(manifest.exportedAt))
    || !settings || !isHistoryLimit(settings.historyLimit) || typeof settings.paused !== 'boolean' || !shortcuts || shortcutError(shortcuts)
    || (settings.timeFormat !== undefined && !isTimeFormat(settings.timeFormat))
    || !Array.isArray(manifest.history) || manifest.history.length > MAX_HISTORY_LIMIT * 2) {
    throw new BackupError('Некорректная структура файла экспорта.')
  }
  let bytes = 0
  let pinned = 0
  const items = manifest.history.map(item => {
    if (!isHistoryItem(item)) throw new BackupError('Файл содержит некорректную запись истории.')
    const size = Buffer.byteLength(item.data, 'utf8') + (item.fileUris ? Buffer.byteLength(JSON.stringify(item.fileUris), 'utf8') : 0)
    bytes += size
    if (item.pinned) pinned++
    if (size > MAX_ITEM_BYTES || bytes > MAX_HISTORY_BYTES || pinned > MAX_HISTORY_LIMIT) {
      throw new BackupError('Превышен допустимый объём истории: 8 МБ на запись, 32 МБ всего и 10 000 избранных.')
    }
    return cleanItem(item)
  })
  return { format: BACKUP_FORMAT, manifestVersion: BACKUP_MANIFEST_VERSION,
    appVersion: manifest.appVersion, exportedAt: manifest.exportedAt,
    settings: { historyLimit: settings.historyLimit, paused: settings.paused,
      timeFormat: settings.timeFormat ?? DEFAULT_TIME_FORMAT, shortcuts }, history: items }
}

export function serializeBackup(items: ClipboardHistoryItem[], settings: BackupSettings, appVersion: string): string {
  const manifest: BackupManifest = { format: BACKUP_FORMAT, manifestVersion: BACKUP_MANIFEST_VERSION,
    appVersion, exportedAt: new Date().toISOString(), settings, history: items.map(cleanItem) }
  const text = JSON.stringify(manifest, null, 2) + '\n'
  if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) throw new BackupError('Файл JSON больше 256 МБ.')
  return text
}

export async function readBackup(filePath: string): Promise<BackupManifest> {
  const file = await open(filePath, 'r')
  try {
    const { size, isFile } = await file.stat().then(stat => ({ size: stat.size, isFile: stat.isFile() }))
    if (!isFile || size > MAX_BACKUP_BYTES) throw new BackupError('Выберите обычный JSON-файл размером до 256 МБ.')
    // Bounded allocation/read, including if the selected file grows during import.
    const buffer = Buffer.alloc(size + 1)
    let read = 0
    while (read < buffer.length) {
      const { bytesRead } = await file.read(buffer, read, buffer.length - read, null)
      if (!bytesRead) break
      read += bytesRead
    }
    if (read > size) throw new BackupError('Файл изменился во время чтения. Повторите импорт.')
    return parseBackup(buffer.subarray(0, read).toString('utf8'))
  } finally { await file.close() }
}

export async function writeBackup(filePath: string, text: string): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, filePath)
  } finally { await unlink(temporary).catch(() => {}) }
}
