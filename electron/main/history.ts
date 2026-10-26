import { createHash, randomUUID } from 'node:crypto'
import {
  HISTORY_LIMIT, MAX_HISTORY_BYTES, MAX_ITEM_BYTES, UNKNOWN_SOURCE, isHistoryItem, isFileUriList, isHistoryLimit, KIND_LABELS,
  type ClipboardHistoryItem, type ClipboardSnapshot, type ClipboardSource, type ClipboardKind, type FileKind,
} from '../../shared/clipboard'
import { classifyText } from '../../shared/content'
import { parseColor } from '../../shared/colors'
import { filePathLabel, fileSummary } from '../../shared/files'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const byteLength = (item: ClipboardHistoryItem) => Buffer.byteLength(item.data, 'utf8') + (item.fileUris ? Buffer.byteLength(JSON.stringify(item.fileUris), 'utf8') : 0)

interface HistoryDependencies {
  read: () => ClipboardSnapshot | Promise<ClipboardSnapshot>
  source: () => Promise<ClipboardSource>
  now?: () => number
  fileKinds?: (uris: string[]) => Promise<FileKind[]>
}

export class ClipboardHistory {
  items: ClipboardHistoryItem[] = []
  paused = false
  historyLimit = HISTORY_LIMIT
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

  hydrate(items: unknown[], paused = false, historyLimit: unknown = HISTORY_LIMIT) {
    this.historyLimit = isHistoryLimit(historyLimit) ? historyLimit : HISTORY_LIMIT
    const ids = new Set<string>()
    this.items = items.filter(isHistoryItem).filter(item => {
      if (ids.has(item.id)) return false
      ids.add(item.id)
      return true
    }).map(item => {
      const type = item.fileUris ? 'file' : item.type === 'image' ? item.type : item.textOrigin === 'file-path' ? 'text' : classifyText(item.data, item.params.source)
      const size = item.fileUris ? fileSummary(item.fileKinds ?? item.fileUris.map(() => 'unknown')) : item.params.size
      return { ...item, type, params: { ...item.params, type, size,
        tags: item.params.tags.map(tag => tag.code === 'type' ? { ...tag, value: KIND_LABELS[type] }
          : tag.code === 'size' ? { ...tag, value: size } : tag) } }
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
    }).slice(0, this.historyLimit)
  }

  setHistoryLimit(limit: unknown) {
    if (!isHistoryLimit(limit)) throw new Error('Некорректный лимит истории.')
    if (this.historyLimit === limit) return
    this.historyLimit = limit
    this.trim()
    this.notify()
  }

  private fingerprints(snapshot: ClipboardSnapshot) {
    return { text: digest(snapshot.text), image: digest(snapshot.image?.data ?? ''), files: digest(JSON.stringify(snapshot.fileUris ?? [])), warning: snapshot.warning ?? '' }
  }

  acknowledgeClipboard(snapshot: ClipboardSnapshot) {
    // App-initiated copies do not create another history record or move selection.
    this.epoch++
    this.previous = this.fingerprints(snapshot)
  }

  private add(type: ClipboardKind, data: string, size: string, source: ClipboardSource, fileUris?: string[], fileKinds?: FileKind[]): ClipboardHistoryItem {
    const existing = this.items.find(item => (item.type === 'image') === (type === 'image')
      && item.data === data && JSON.stringify(item.fileUris) === JSON.stringify(fileUris))
    this.items = this.items.filter(item => item !== existing)
    if (fileUris) {
      fileKinds = fileUris.map((_, index) => fileKinds?.[index] === 'unknown'
        ? existing?.fileKinds?.[index] ?? 'unknown' : fileKinds?.[index] ?? existing?.fileKinds?.[index] ?? 'unknown')
      size = fileSummary(fileKinds)
    }
    const item: ClipboardHistoryItem = {
      id: existing?.id ?? randomUUID(), type, data, createdAt: this.deps.now?.() ?? Date.now(),
      ...(fileUris ? { fileUris } : {}),
      ...(fileKinds ? { fileKinds } : {}),
      ...(type === 'text' && existing?.textOrigin ? { textOrigin: existing.textOrigin } : {}),
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

  recordColorCopy(text: string): ClipboardHistoryItem {
    if (!parseColor(text)) throw new Error('Не удалось сохранить цвет.')
    this.acknowledgeClipboard({ text, image: null })
    const item = this.add('color', text, `${text.length} симв.`, { name: 'ClipClip', title: 'Конвертация цвета' })
    this.trim()
    this.notify()
    return item
  }

  updateFileKinds(id: string, kinds?: FileKind[]) {
    const item = this.items.find(item => item.id === id && item.fileUris)
    if (!item || kinds?.length !== item.fileUris!.length) return
    const resolved = kinds.map((kind, index) => kind === 'unknown' ? item.fileKinds?.[index] ?? kind : kind)
    if (JSON.stringify(resolved) === JSON.stringify(item.fileKinds)) return
    item.fileKinds = resolved
    item.params.size = fileSummary(resolved)
    item.params.tags = item.params.tags.map(tag => tag.code === 'size' ? { ...tag, value: item.params.size } : tag)
    this.notify()
  }

  recordFilePathCopy(text: string): ClipboardHistoryItem {
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_ITEM_BYTES) throw new Error('Не удалось сохранить путь.')
    this.acknowledgeClipboard({ text, image: null })
    const item = this.add('text', text, `${text.length} симв.`, { name: 'ClipClip', title: 'Копирование пути' })
    // A path ending in .pdf or .docx is still plain text after restarting.
    item.textOrigin = 'file-path'
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
      const files = isFileUriList(snapshot.fileUris) ? snapshot.fileUris : undefined
      let fileKinds: FileKind[] | undefined
      if (filesChanged && files) {
        try { fileKinds = await this.deps.fileKinds?.(files) } catch { /* Preserve the record when filesystem metadata is unavailable. */ }
      }
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
        this.add(type, data, size, type === 'image' ? snapshot.imageSource ?? source : source, fileUris, fileKinds)
      }
      if (filesChanged && files) {
        const paths = files.map(filePathLabel).join('\n')
        add('file', paths, '', [...files])
      }
      if (!files && textChanged && snapshot.text) {
        const savedPath = this.items.some(item => item.textOrigin === 'file-path' && item.data === snapshot.text)
        add(savedPath ? 'text' : classifyText(snapshot.text, source), snapshot.text, `${snapshot.text.length} симв.`)
      }
      if (!files && imageChanged && snapshot.image && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(snapshot.image.data)) {
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
