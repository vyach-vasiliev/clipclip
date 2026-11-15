import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MAX_HISTORY_BYTES, type ClipboardHistoryItem } from '../../shared/clipboard'
import type { ShortcutSettings } from '../../shared/shortcuts'

export interface StoredHistory { items: ClipboardHistoryItem[]; paused: boolean; historyLimit?: number; shortcuts?: ShortcutSettings }
export interface HistoryEncryption {
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<string>
}

export class EncryptedHistoryStorage {
  private pending: Promise<void> = Promise.resolve()
  constructor(private readonly file: string, private readonly crypto: HistoryEncryption) {}

  async load(): Promise<StoredHistory> {
    try {
      if ((await stat(this.file)).size > MAX_HISTORY_BYTES * 2) throw new Error('Invalid history size')
      const data = JSON.parse(await this.crypto.decrypt(await readFile(this.file))) as StoredHistory
      if (!Array.isArray(data.items) || typeof data.paused !== 'boolean') throw new Error('Invalid history')
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], paused: false }
      throw new Error('Не удалось открыть сохранённую историю. Текущая сессия доступна в памяти.')
    }
  }

  save(state: StoredHistory): Promise<void> {
    // Serialize immediately: later captures cannot alter a queued snapshot.
    const serialized = JSON.stringify(state)
    const write = async () => {
      const encrypted = await this.crypto.encrypt(serialized)
      await mkdir(path.dirname(this.file), { recursive: true })
      const temporary = this.file + '.tmp'
      await writeFile(temporary, encrypted, { mode: 0o600 })
      await rename(temporary, this.file)
    }
    this.pending = this.pending.catch(() => {}).then(write)
    return this.pending
  }

  flush(): Promise<void> { return this.pending }
}
