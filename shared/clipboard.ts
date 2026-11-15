import type { ColorFormat } from './colors'
import type { ShortcutSettings } from './shortcuts'
import type { BackupResult } from './backup'

export type ClipboardKind = 'text' | 'image' | 'document' | 'link' | 'file' | 'color'
export type FileKind = 'file' | 'folder' | 'unknown'

export interface FileCheckResult {
  status: 'available' | 'missing' | 'unavailable'
  message: string
  kinds?: FileKind[]
}

export interface ClipboardTag {
  code: 'size' | 'type' | 'source'
  value: string
}

export interface ClipboardSource {
  name: string
  title: string
}

export interface ClipboardHistoryItem {
  id: string
  type: ClipboardKind
  data: string
  fileUris?: string[]
  fileKinds?: FileKind[]
  textOrigin?: 'file-path'
  pinned?: boolean
  createdAt: number
  params: {
    size: string
    type: ClipboardKind
    source: ClipboardSource
    tags: ClipboardTag[]
  }
}

export interface ClipboardImage {
  data: string
  width: number
  height: number
}

export interface ClipboardSnapshot {
  text: string
  image: ClipboardImage | null
  imageSource?: ClipboardSource
  fileUris?: string[]
  warning?: string
}

export interface HistoryState {
  revision: number
  items: ClipboardHistoryItem[]
  historyLimit: number
  shortcuts: ShortcutSettings
  paused: boolean
  canUndo: boolean
  persistent: boolean
  shortcutAvailable: boolean
  error: string | null
}

export interface ElectronAPI {
  getHistory(): Promise<HistoryState>
  onHistoryChanged(callback: (state: HistoryState) => void): () => void
  copyItem(id: string): Promise<void | FileCheckResult>
  copyColor(id: string, format: ColorFormat): Promise<ClipboardHistoryItem>
  checkFiles(id: string): Promise<FileCheckResult>
  revealFile(id: string, index: number): Promise<FileCheckResult>
  copyFilePath(id: string, index: number): Promise<ClipboardHistoryItem>
  saveTextRevision(id: string, text: string): Promise<ClipboardHistoryItem>
  deleteItem(id: string): Promise<void>
  undoDelete(): Promise<void>
  setPaused(paused: boolean): Promise<void>
  setHistoryLimit(limit: number): Promise<void>
  setPinned(id: string, pinned: boolean): Promise<void>
  clearHistory(): Promise<void>
  exportHistory(): Promise<BackupResult>
  importHistory(includeSettings: boolean): Promise<BackupResult>
  setShortcuts(shortcuts: ShortcutSettings): Promise<void>
  setShortcutCapture(active: boolean): Promise<void>
  hideWindow(): Promise<void>
  setPreviewFullscreen(fullscreen: boolean): Promise<void>
  onPreviewFullscreenChanged(callback: (fullscreen: boolean) => void): () => void
  onWindowShown(callback: () => void): () => void
}

export const CHANNELS = {
  getHistory: 'history:get',
  changed: 'history:changed',
  copyItem: 'history:copy',
  copyColor: 'history:copy-color',
  checkFiles: 'history:check-files',
  revealFile: 'history:reveal-file',
  copyFilePath: 'history:copy-file-path',
  saveTextRevision: 'history:save-text-revision',
  deleteItem: 'history:delete',
  undoDelete: 'history:undo',
  setPaused: 'history:pause',
  setHistoryLimit: 'history:set-limit',
  setPinned: 'history:set-pinned',
  clearHistory: 'history:clear',
  exportHistory: 'history:export',
  importHistory: 'history:import',
  setShortcuts: 'settings:shortcuts',
  setShortcutCapture: 'settings:shortcut-capture',
  hideWindow: 'window:hide',
  windowShown: 'window:shown',
  setPreviewFullscreen: 'window:preview-fullscreen',
  previewFullscreenChanged: 'window:preview-fullscreen-changed',
} as const

export const HISTORY_LIMIT = 100
export const MAX_HISTORY_LIMIT = 10_000
export function isHistoryLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_HISTORY_LIMIT
}
export const MAX_ITEM_BYTES = 8 * 1024 * 1024
export const MAX_HISTORY_BYTES = 32 * 1024 * 1024

export const UNKNOWN_SOURCE: ClipboardSource = { name: 'Неизвестно', title: '' }
export const TAG_LABELS = { size: 'Размер', type: 'Тип', source: 'Источник' } as const
export const KIND_LABELS = { text: 'Текст', image: 'Изображение', document: 'Документ', link: 'Ссылка', file: 'Файлы и папки', color: 'Цвет' } as const

export function isFileUriList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100
    && value.every(uri => {
      if (typeof uri !== 'string' || uri.length > 32768 || /[\r\n\0]/.test(uri)) return false
      try { const url = new URL(uri); return url.protocol === 'file:' && !!url.pathname && !/[\r\n\0]/.test(decodeURIComponent(url.pathname)) && !url.username && !url.password && !url.search && !url.hash }
      catch { return false }
    })
}

export function tagKey(tag: ClipboardTag): string {
  return JSON.stringify([tag.code, tag.value])
}

export function isHistoryItem(value: unknown): value is ClipboardHistoryItem {
  if (!value || typeof value !== 'object') return false
  const item = value as ClipboardHistoryItem
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100
    && (item.pinned === undefined || typeof item.pinned === 'boolean')
    && ['text', 'image', 'document', 'link', 'file', 'color'].includes(item.type)
    && typeof item.data === 'string' && item.data.length <= MAX_ITEM_BYTES
    && (item.type !== 'image' || /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.data))
    && (item.fileUris === undefined || (['document', 'file'].includes(item.type) && isFileUriList(item.fileUris)))
    && (item.type !== 'file' || isFileUriList(item.fileUris))
    && (item.textOrigin === undefined || (item.textOrigin === 'file-path' && item.type === 'text' && !item.fileUris))
    && (item.fileKinds === undefined || (Array.isArray(item.fileKinds) && item.fileKinds.length === item.fileUris?.length
      && item.fileKinds.every(kind => ['file', 'folder', 'unknown'].includes(kind))))
    && Number.isFinite(item.createdAt) && !!item.params
    && typeof item.params.size === 'string' && item.params.size.length <= 100
    && item.params.type === item.type && !!item.params.source
    && typeof item.params.source.name === 'string' && item.params.source.name.length <= 500
    && typeof item.params.source.title === 'string' && item.params.source.title.length <= 2000
    && Array.isArray(item.params.tags) && item.params.tags.length <= 3
    && item.params.tags.every(tag => tag && ['size', 'type', 'source'].includes(tag.code)
      && typeof tag.value === 'string' && tag.value.length <= 500)
}
