import { createHash, randomUUID } from 'node:crypto'
import {
  HISTORY_LIMIT, MAX_HISTORY_BYTES, MAX_ITEM_BYTES, UNKNOWN_SOURCE, isHistoryItem, isFileUriList, KIND_LABELS,
  type ClipboardHistoryItem, type ClipboardSnapshot, type ClipboardSource, type ClipboardKind,
} from '../../shared/clipboard'
import { classifyText, isDocumentFile } from '../../shared/content'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const byteLength = (item: ClipboardHistoryItem) => Buffer.byteLength(item.data, 'utf8') + (item.fileUris ? Buffer.byteLength(JSON.stringify(item.fileUris), 'utf8') : 0)

interface HistoryDependencies {
  read: () => ClipboardSnapshot | Promise<ClipboardSnapshot>
  source: () => Promise<ClipboardSource>
  now?: () => number
}

export class ClipboardHistory {
  items: ClipboardHistoryItem[] = []
  paused = false
  error: string | null = null
  private busy = false
  private epoch = 0
  private previous: { text: string; image: string; files: string; warning: string } | null = null
  private listeners = new Set<() => void>()
  private deleted: { item: ClipboardHistoryItem; index: number } | null = null
  private undoTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: HistoryDependencies) {}

  get canUndo() { return this.deleted !== null }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() { this.listeners.forEach(listener => listener()) }

  hydrate(items: unknown[], paused = false) {
    const ids = new Set<string>()
    this.items = items.filter(isHistoryItem).filter(item => {
      if (ids.has(item.id)) return false
      ids.add(item.id)
      return true
    }).map(item => {
      const type = item.type === 'image' || item.fileUris ? item.type : classifyText(item.data, item.params.source)
      return { ...item, type, params: { ...item.params, type,
        tags: item.params.tags.map(tag => tag.code === 'type' ? { ...tag, value: KIND_LABELS[type] } : tag) } }
    })
    this.paused = paused
    this.trim()
  }

  private trim() {
    let bytes = 0
    this.items = this.items.filter(item => {
      const size = byteLength(item)
      if (size > MAX_ITEM_BYTES || bytes + size > MAX_HISTORY_BYTES) return false
      bytes += size
      return true
    }).slice(0, HISTORY_LIMIT)
  }

  private fingerprints(snapshot: ClipboardSnapshot) {
    return { text: digest(snapshot.text), image: digest(snapshot.image?.data ?? ''), files: digest(JSON.stringify(snapshot.fileUris ?? [])), warning: snapshot.warning ?? '' }
  }

  acknowledgeClipboard(snapshot: ClipboardSnapshot) {
    // App-initiated copies do not create another history record or move selection.
    this.epoch++
    this.previous = this.fingerprints(snapshot)
  }

  private add(type: ClipboardKind, data: string, size: string, source: ClipboardSource, fileUris?: string[]): ClipboardHistoryItem {
    const existing = this.items.find(item => (item.type === 'image') === (type === 'image')
      && item.data === data && JSON.stringify(item.fileUris) === JSON.stringify(fileUris))
    this.items = this.items.filter(item => item !== existing)
    const item: ClipboardHistoryItem = {
      id: existing?.id ?? randomUUID(), type, data, createdAt: this.deps.now?.() ?? Date.now(),
      ...(fileUris ? { fileUris } : {}),
      params: { size, type, source, tags: [
        { code: 'size', value: size },
        { code: 'type', value: KIND_LABELS[type] },
        { code: 'source', value: source.name },
      ] },
    }
    this.items.unshift(item)
    return item
  }

  saveTextRevision(id: string, text: string): ClipboardHistoryItem {
    const original = this.items.find(item => item.id === id && item.type !== 'image' && !item.fileUris)
    if (!original) throw new Error('Исходная запись уже удалена.')
    if (Buffer.byteLength(text, 'utf8') > MAX_ITEM_BYTES) throw new Error('Текст больше 8 МБ.')
    if (original.data === text) return original
    const item = this.add(classifyText(text, original.params.source), text, `${text.length} симв.`, original.params.source)
    this.trim()
    this.notify()
    return item
  }

  async capture(): Promise<void> {
    if (this.busy || this.paused) return
    this.busy = true
    const epoch = this.epoch
    try {
      const snapshot = await this.deps.read()
      const next = this.fingerprints(snapshot)
      if (this.previous?.text === next.text && this.previous.image === next.image && this.previous.files === next.files && this.previous.warning === next.warning) return
      const textChanged = this.previous?.text !== next.text
      const imageChanged = this.previous?.image !== next.image
      const filesChanged = this.previous?.files !== next.files
      let source = UNKNOWN_SOURCE
      try { source = await this.deps.source() } catch { /* Source attribution is best effort. */ }
      if (this.paused || this.epoch !== epoch) return
      // Relaunching while ClipClip owns focus must not downgrade a saved document's attribution.
      if (source === UNKNOWN_SOURCE && snapshot.text) {
        source = this.items.find(item => item.type !== 'image' && !item.fileUris && item.data === snapshot.text)?.params.source ?? source
      }
      this.previous = next
      this.error = snapshot.warning ?? null

      const add = (type: ClipboardKind, data: string, size: string, fileUris?: string[]) => {
        if (Buffer.byteLength(data, 'utf8') + (fileUris ? Buffer.byteLength(JSON.stringify(fileUris), 'utf8') : 0) > MAX_ITEM_BYTES) {
          this.error = 'Запись больше 8 МБ пропущена.'
          return
        }
        this.add(type, data, size, source, fileUris)
      }
      const documents = isFileUriList(snapshot.fileUris) && snapshot.fileUris.some(isDocumentFile) ? snapshot.fileUris : undefined
      if (filesChanged && documents) {
        const paths = documents.map(uri => {
          const url = new URL(uri)
          return (url.hostname ? '//' + url.hostname : '') + decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:\/)/, '')
        }).join('\n')
        add('document', paths, `${documents.length} файл.`, [...documents])
      }
      if (!documents && textChanged && snapshot.text) add(classifyText(snapshot.text, source), snapshot.text, `${snapshot.text.length} симв.`)
      if (!documents && imageChanged && snapshot.image && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(snapshot.image.data)) {
        add('image', snapshot.image.data, `${snapshot.image.width} × ${snapshot.image.height}`)
      }
      this.trim()
      this.notify()
    } catch {
      this.error = 'Не удалось прочитать буфер обмена. Проверка будет повторена.'
      this.notify()
    } finally { this.busy = false }
  }

  setPaused(paused: boolean) {
    if (this.paused === paused) return
    this.paused = paused
    this.epoch++
    this.notify()
  }

  delete(id: string) {
    const index = this.items.findIndex(item => item.id === id)
    if (index < 0) return
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.deleted = { item: this.items[index], index }
    this.items.splice(index, 1)
    this.undoTimer = setTimeout(() => {
      this.deleted = null
      this.undoTimer = null
      this.notify()
    }, 10_000)
    this.undoTimer.unref?.()
    this.notify()
  }

  undoDelete() {
    if (!this.deleted) return
    const { item, index } = this.deleted
    this.items = this.items.filter(existing => existing.id !== item.id)
    this.items.splice(Math.min(index, this.items.length), 0, item)
    this.deleted = null
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.undoTimer = null
    this.trim()
    this.notify()
  }

  dispose() {
    this.epoch++
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.deleted = null
    this.listeners.clear()
  }
}

export class ClipboardMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private generation = 0

  constructor(private readonly history: ClipboardHistory, private readonly delay = 700) {}

  start() {
    if (this.running) return
    this.running = true
    const generation = ++this.generation
    const tick = async () => {
      await this.history.capture()
      if (!this.running || generation !== this.generation) return
      this.timer = setTimeout(tick, this.delay)
      this.timer.unref?.()
    }
    void tick()
  }

  stop() {
    this.running = false
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
