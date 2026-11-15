import type { ClipboardHistoryItem } from './clipboard'
import type { ShortcutSettings } from './shortcuts'

// Version the whole document, independently of the application release.
export const BACKUP_FORMAT = 'clipclip-backup'
export const BACKUP_MANIFEST_VERSION = 1

export interface BackupSettings {
  historyLimit: number
  paused: boolean
  shortcuts: ShortcutSettings
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  manifestVersion: typeof BACKUP_MANIFEST_VERSION
  appVersion: string
  exportedAt: string
  settings: BackupSettings
  history: ClipboardHistoryItem[]
}

export type BackupResult =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }
