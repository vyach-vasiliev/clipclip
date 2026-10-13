export type ClipboardKind = 'text' | 'image'

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
  warning?: string
}

export interface HistoryState {
  revision: number
  items: ClipboardHistoryItem[]
  paused: boolean
  canUndo: boolean
  persistent: boolean
  shortcutAvailable: boolean
  error: string | null
}

export interface ElectronAPI {
  getHistory(): Promise<HistoryState>
  onHistoryChanged(callback: (state: HistoryState) => void): () => void
  copyItem(id: string): Promise<void>
  saveTextRevision(id: string, text: string): Promise<ClipboardHistoryItem>
  deleteItem(id: string): Promise<void>
  undoDelete(): Promise<void>
  setPaused(paused: boolean): Promise<void>
  hideWindow(): Promise<void>
  setPreviewFullscreen(fullscreen: boolean): Promise<void>
  onPreviewFullscreenChanged(callback: (fullscreen: boolean) => void): () => void
  onWindowShown(callback: () => void): () => void
}

export const CHANNELS = {
  getHistory: 'history:get',
  changed: 'history:changed',
  copyItem: 'history:copy',
  saveTextRevision: 'history:save-text-revision',
  deleteItem: 'history:delete',
  undoDelete: 'history:undo',
  setPaused: 'history:pause',
  hideWindow: 'window:hide',
  windowShown: 'window:shown',
  setPreviewFullscreen: 'window:preview-fullscreen',
  previewFullscreenChanged: 'window:preview-fullscreen-changed',
} as const

export const HISTORY_LIMIT = 10
export const MAX_ITEM_BYTES = 8 * 1024 * 1024
export const MAX_HISTORY_BYTES = 32 * 1024 * 1024

export const UNKNOWN_SOURCE: ClipboardSource = { name: 'Неизвестно', title: '' }
export const TAG_LABELS = { size: 'Размер', type: 'Тип', source: 'Источник' } as const

export function tagKey(tag: ClipboardTag): string {
  return JSON.stringify([tag.code, tag.value])
}

export function isHistoryItem(value: unknown): value is ClipboardHistoryItem {
  if (!value || typeof value !== 'object') return false
  const item = value as ClipboardHistoryItem
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100
    && (item.type === 'text' || item.type === 'image')
    && typeof item.data === 'string' && item.data.length <= MAX_ITEM_BYTES
    && (item.type !== 'image' || /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.data))
    && Number.isFinite(item.createdAt) && !!item.params
    && typeof item.params.size === 'string' && item.params.size.length <= 100
    && item.params.type === item.type && !!item.params.source
    && typeof item.params.source.name === 'string' && item.params.source.name.length <= 500
    && typeof item.params.source.title === 'string' && item.params.source.title.length <= 2000
    && Array.isArray(item.params.tags) && item.params.tags.length <= 3
    && item.params.tags.every(tag => tag && ['size', 'type', 'source'].includes(tag.code)
      && typeof tag.value === 'string' && tag.value.length <= 500)
}
