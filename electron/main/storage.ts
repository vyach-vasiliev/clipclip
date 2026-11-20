import { randomUUID } from 'node:crypto'
import { renameSync } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ClipboardHistoryItem } from '../../shared/clipboard'
import type { ShortcutSettings } from '../../shared/shortcuts'
import type { TimeFormat } from '../../shared/time'
import type { ClipboardClearBaseline } from './history'

// The 32 MiB content budget excludes metadata and JSON escapes can expand
// individual bytes sixfold. This separate bound applies to the encrypted file.
export const MAX_ENCRYPTED_HISTORY_BYTES = 256 * 1024 * 1024
export class HistoryStorageLimitError extends Error {
  constructor() { super('Зашифрованная история слишком велика для сохранения.') }
}

export interface StoredHistory {
  items: ClipboardHistoryItem[]
  paused: boolean
  historyLimit?: number
  shortcuts?: ShortcutSettings
  timeFormat?: TimeFormat
  pasteOnSelect?: boolean
  promoteCopiedRecords?: boolean
  clipboardClearBaseline?: ClipboardClearBaseline
}
export interface HistoryEncryption {
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<string>
}

export class EncryptedHistoryStorage {
  private pending: Promise<void> = Promise.resolve()
  constructor(private readonly file: string, private readonly crypto: HistoryEncryption) {}

  async load(): Promise<StoredHistory> {
    try {
      if ((await stat(this.file)).size > MAX_ENCRYPTED_HISTORY_BYTES) throw new Error('Invalid history size')
      const encrypted = await readFile(this.file)
      if (encrypted.length > MAX_ENCRYPTED_HISTORY_BYTES) throw new Error('Invalid history size')
      const data = JSON.parse(await this.crypto.decrypt(encrypted)) as StoredHistory
      if (!Array.isArray(data.items) || typeof data.paused !== 'boolean') throw new Error('Invalid history')
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], paused: false }
      throw new Error('Не удалось открыть сохранённую историю. Текущая сессия доступна в памяти.')
    }
  }

  save(state: StoredHistory, commit?: (replace: () => void) => void | Promise<void>): Promise<void> {
    // Serialize immediately: later captures cannot alter a queued snapshot.
    const serialized = JSON.stringify(state)
    const write = async () => {
      const encrypted = await this.crypto.encrypt(serialized)
      if (encrypted.length > MAX_ENCRYPTED_HISTORY_BYTES) throw new HistoryStorageLimitError()
      await mkdir(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600, flush: !!commit })
        // Imports perform the final state check and file replacement in one turn.
        if (commit) await commit(() => renameSync(temporary, this.file))
        else await rename(temporary, this.file)
      } finally { await unlink(temporary).catch(() => {}) }
    }
    this.pending = this.pending.catch(() => {}).then(write)
    return this.pending
  }

  flush(): Promise<void> { return this.pending }
}
