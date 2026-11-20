import { createHash, randomUUID } from 'node:crypto'
import {
  HISTORY_LIMIT, MAX_HISTORY_LIMIT, MAX_HISTORY_BYTES, MAX_ITEM_BYTES, UNKNOWN_SOURCE, isHistoryItem, isFileUriList, isHistoryLimit, KIND_LABELS,
  type ClipboardHistoryItem, type ClipboardSnapshot, type ClipboardSource, type ClipboardKind, type FileKind,
} from '../../shared/clipboard'
import { classifyText } from '../../shared/content'
import { parseColor } from '../../shared/colors'
import { filePathLabel, fileSummary } from '../../shared/files'
import type { BackupSettings } from '../../shared/backup'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const byteLength = (item: ClipboardHistoryItem) => Buffer.byteLength(item.data, 'utf8') + (item.fileUris ? Buffer.byteLength(JSON.stringify(item.fileUris), 'utf8') : 0)

function matchesContent(item: ClipboardHistoryItem, type: ClipboardKind, data: string, fileUris?: string[]): boolean {
  if ((item.type === 'image') !== (type === 'image') || item.data !== data) return false
  const savedUris = item.fileUris
  if (!fileUris || !savedUris) return fileUris === savedUris
  return fileUris.length === savedUris.length && fileUris.every((uri, index) => uri === savedUris[index])
}

interface ClipboardFingerprints { text: string; image: string; files: string }
export type ClipboardClearBaseline = ClipboardFingerprints | 'next-capture'
export type PauseBaseline =
  | { persisted: 'next-capture'; sequence: number }
  | { persisted: ClipboardFingerprints; warning: string }

function restoreClearBaseline(value: unknown): ClipboardClearBaseline | undefined {
  if (value === 'next-capture') return value
  if (!value || typeof value !== 'object') return undefined
  const { text, image, files } = value as Partial<ClipboardFingerprints>
  const hash = (candidate: unknown): candidate is string => typeof candidate === 'string' && /^[0-9a-f]{64}$/.test(candidate)
  if (hash(text) && hash(image) && hash(files)) return { text, image, files }
}

interface HistoryDependencies {
  read: () => ClipboardSnapshot | undefined | Promise<ClipboardSnapshot | undefined>
  sequence?: () => number | undefined
  source: () => Promise<ClipboardSource>
  now?: () => number
}

export class ClipboardHistory {
  items: ClipboardHistoryItem[] = []
  paused = false
  historyLimit = HISTORY_LIMIT
  error: string | null = null
  private captureTask: Promise<void> | undefined
  private clearing = false
  private epoch = 0
  private previous: (ClipboardFingerprints & { warning: string }) | null = null
  private clearBaseline: ClipboardClearBaseline | undefined
  private baselineSequence: number | undefined
  private pauseRequest = 0
  private listeners = new Set<() => void>()
  private deleted: { item: ClipboardHistoryItem; nextId?: string } | null = null
  private undoTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: HistoryDependencies) {}

  get canUndo() { return this.deleted !== null }
  get clipboardClearBaseline() { return this.clearBaseline }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() { this.listeners.forEach(listener => listener()) }

  hydrate(items: unknown[], paused = false, historyLimit: unknown = HISTORY_LIMIT, baseline?: unknown) {
    const restored = restoreClearBaseline(baseline)
    if (restored) {
      this.clearBaseline = restored
      if (restored !== 'next-capture') this.previous = { ...restored, warning: '' }
    }
    this.historyLimit = isHistoryLimit(historyLimit) ? historyLimit : HISTORY_LIMIT
    this.items = this.normalizeItems(items)
    this.paused = paused
    this.trim()
  }

  private normalizeItems(items: unknown[]): ClipboardHistoryItem[] {
    const ids = new Set<string>()
    return items.filter(isHistoryItem).filter(item => {
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
  }

  private trim() {
    let bytes = 0
    let ordinary = 0
    const kept = new Set<string>()
    // Reserve space for favorites before admitting ordinary captures.
    for (const item of [...this.items.filter(item => item.pinned), ...this.items.filter(item => !item.pinned)]) {
      const size = byteLength(item)
      if (size > MAX_ITEM_BYTES || bytes + size > MAX_HISTORY_BYTES || (!item.pinned && ordinary >= this.historyLimit)) continue
      bytes += size
      if (!item.pinned) ordinary++
      kept.add(item.id)
    }
    this.items = this.items.filter(item => kept.has(item.id))
  }

  planImport(incoming: ClipboardHistoryItem[], settings?: Pick<BackupSettings, 'historyLimit' | 'paused'>) {
    const key = (item: ClipboardHistoryItem) => digest(JSON.stringify([item.type === 'image', item.data, item.fileUris ?? null]))
    const ids = new Set(this.items.map(item => item.id))
    const currentPins = new Set(this.items.filter(item => item.pinned).map(item => item.id))
    const merged = this.items.map(item => ({ ...item }))
    const byContent = new Map(merged.map(item => [key(item), item]))
    const added = new Set<string>()
    let duplicates = 0
    for (const original of incoming) {
      const content = key(original)
      const existing = byContent.get(content)
      if (existing) { if (original.pinned) existing.pinned = true; duplicates++; continue }
      const item = { ...original, id: ids.has(original.id) ? randomUUID() : original.id }
      ids.add(item.id)
      added.add(item.id)
      merged.push(item)
      byContent.set(content, item)
    }
    merged.sort((a, b) => b.createdAt - a.createdAt)
    let bytes = 0
    let ordinary = 0
    let pinned = 0
    const kept = new Set<string>()
    const limit = settings?.historyLimit ?? this.historyLimit
    // Existing favorites keep their reserved space when importing another history.
    const priority = [...merged.filter(item => currentPins.has(item.id)),
      ...merged.filter(item => item.pinned && !currentPins.has(item.id)), ...merged.filter(item => !item.pinned)]
    for (const item of priority) {
      const size = byteLength(item)
      if (size > MAX_ITEM_BYTES || bytes + size > MAX_HISTORY_BYTES
        || (item.pinned ? pinned >= MAX_HISTORY_LIMIT : ordinary >= limit)) continue
      bytes += size
      if (item.pinned) pinned++; else ordinary++
      kept.add(item.id)
    }
    const items = this.normalizeItems(merged.filter(item => kept.has(item.id)))
    const acceptedIds = new Set(items.map(item => item.id))
    const removedIds = this.items.filter(item => !acceptedIds.has(item.id)).map(item => item.id)
    const imported = [...added].filter(id => acceptedIds.has(id)).length
    return { items, historyLimit: limit, paused: settings?.paused ?? this.paused, removedIds,
      result: { imported, duplicates, skipped: added.size - imported, removed: removedIds.length } }
  }

  commitImport(plan: ReturnType<ClipboardHistory['planImport']>, prepared?: PauseBaseline) {
    const resuming = this.paused && !plan.paused
    if (resuming && !prepared) throw new Error('Не удалось возобновить запись истории.')
    this.epoch++
    this.deleted = null
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.undoTimer = null
    this.items = plan.items
    this.historyLimit = plan.historyLimit
    this.paused = plan.paused
    if (resuming && prepared) this.applyResumeBaseline(prepared, true)
    this.error = null
    this.notify()
    return plan.result
  }

  setPinned(id: string, pinned: boolean) {
    const item = this.items.find(item => item.id === id)
    if (!item) throw new Error('Запись уже удалена.')
    if (!!item.pinned === pinned) return
    if (pinned && this.items.filter(item => item.pinned).length >= MAX_HISTORY_LIMIT) throw new Error('Достигнут лимит избранных записей.')
    item.pinned = pinned
    this.trim()
    this.notify()
  }

  async clear() {
    if (this.clearing) return
    this.clearing = true
    const epoch = ++this.epoch
    const sequence = this.clipboardSequence()
    this.clearBaseline = 'next-capture'
    this.baselineSequence = sequence
    this.previous = null
    this.items = []
    this.deleted = null
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.undoTimer = null
    this.error = null
    this.notify()
    try {
      // Establish a new baseline without writing to the system clipboard.
      const snapshot = await this.deps.read()
      if (snapshot && this.epoch === epoch && (sequence === undefined || this.clipboardSequence() === sequence)) {
        this.rememberClipboard(this.fingerprints(snapshot))
      }
    } catch { /* Deletion still succeeds if the clipboard is temporarily unavailable. */ }
    finally { this.clearing = false; this.notify() }
  }

  setHistoryLimit(limit: unknown) {
    if (!isHistoryLimit(limit)) throw new Error('Некорректный лимит истории.')
    this.updatePreferences(limit, this.paused)
  }

  resetSettings(resume?: PauseBaseline): boolean {
    // Keep the existing limit if reverting it would discard saved entries.
    const ordinaryCount = this.items.filter(item => !item.pinned).length
    const limit = ordinaryCount <= HISTORY_LIMIT ? HISTORY_LIMIT : this.historyLimit
    return this.updatePreferences(limit, false, resume)
  }

  private updatePreferences(limit: number, paused: boolean, resume?: PauseBaseline): boolean {
    const limitChanged = this.historyLimit !== limit
    const pausedChanged = this.paused !== paused
    if (!limitChanged && !pausedChanged) return false
    if (pausedChanged && !paused) this.applyResumeBaseline(resume)
    this.historyLimit = limit
    this.paused = paused
    if (limitChanged) this.trim()
    if (pausedChanged) this.epoch++
    this.notify()
    return true
  }

  private fingerprints(snapshot: ClipboardSnapshot) {
    return { text: digest(snapshot.text), image: digest(snapshot.image?.data ?? ''), files: digest(JSON.stringify(snapshot.fileUris ?? [])), warning: snapshot.warning ?? '' }
  }

  private clipboardSequence() {
    try {
      const sequence = this.deps.sequence?.()
      return sequence && Number.isInteger(sequence) && sequence > 0 ? sequence : undefined
    } catch { return undefined }
  }

  async prepareResume(): Promise<PauseBaseline | undefined> {
    if (!this.paused) return
    const sequence = this.clipboardSequence()
    if (sequence !== undefined) return { persisted: 'next-capture', sequence }

    if (this.captureTask) await this.captureTask
    const snapshot = await Promise.resolve().then(() => this.deps.read()).catch(() => undefined)
    if (!snapshot) throw new Error('Буфер обмена недоступен. Запись остаётся на паузе.')
    const recoveredSequence = this.clipboardSequence()
    if (recoveredSequence !== undefined) return { persisted: 'next-capture', sequence: recoveredSequence }
    const { text, image, files, warning } = this.fingerprints(snapshot)
    return { persisted: { text, image, files }, warning }
  }

  private applyResumeBaseline(resume?: PauseBaseline, refreshSequence = false) {
    if (!resume) throw new Error('Буфер обмена недоступен. Запись остаётся на паузе.')
    this.clearBaseline = resume.persisted
    if ('sequence' in resume) {
      // Native sequence numbers only identify contents in the current session.
      // Keep the conservative sentinel on disk until a fingerprint is available.
      this.baselineSequence = refreshSequence ? this.clipboardSequence() : resume.sequence
      this.previous = null
      this.error = null
    } else {
      this.baselineSequence = undefined
      this.previous = { ...resume.persisted, warning: resume.warning }
      this.error = resume.warning || null
    }
  }

  private rememberClipboard(next: ClipboardFingerprints & { warning: string }) {
    this.previous = next
    this.baselineSequence = undefined
    if (this.clearBaseline) {
      const { text, image, files } = next
      this.clearBaseline = { text, image, files }
    }
  }

  acknowledgeClipboard(snapshot: ClipboardSnapshot) {
    // App-initiated copies do not create another history record or move selection.
    this.epoch++
    this.rememberClipboard(this.fingerprints(snapshot))
  }

  private add(type: ClipboardKind, data: string, size: string, source: ClipboardSource, fileUris?: string[]): ClipboardHistoryItem {
    const existing = this.items.find(item => matchesContent(item, type, data, fileUris))
    // Regression guard: on relaunch the screenshot's owner may already be gone.
    // Recapturing identical image bytes must not replace a saved source with UNKNOWN_SOURCE.
    if (type === 'image' && source.name === UNKNOWN_SOURCE.name && existing) source = existing.params.source
    this.items = this.items.filter(item => item !== existing)
    const fileKinds = fileUris?.map((_, index) => existing?.fileKinds?.[index] ?? 'unknown')
    if (fileKinds) size = fileSummary(fileKinds)
    const item: ClipboardHistoryItem = {
      id: existing?.id ?? randomUUID(), type, data, createdAt: this.deps.now?.() ?? Date.now(),
      ...(existing?.pinned ? { pinned: true } : {}),
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

  promoteCopiedItem(id: string) {
    const index = this.items.findIndex(item => item.id === id)
    if (index <= 0) return
    const item = { ...this.items[index], createdAt: this.deps.now?.() ?? Date.now() }
    this.items = [item, ...this.items.slice(0, index), ...this.items.slice(index + 1)]
    this.notify()
  }

  saveTextRevision(id: string | null, text: string): ClipboardHistoryItem {
    const original = id === null ? undefined : this.items.find(item => item.id === id && item.type !== 'image' && !item.fileUris)
    if (id !== null && !original) throw new Error('Исходная запись уже удалена.')
    if (Buffer.byteLength(text, 'utf8') > MAX_ITEM_BYTES) throw new Error('Текст больше 8 МБ.')
    if (original?.data === text) return original
    const source = original?.params.source ?? { name: 'ClipClip', title: 'Редактирование текста' }
    const previousItems = this.items
    const item = this.add(classifyText(text, source), text, `${text.length} симв.`, source)
    this.trim()
    if (!this.items.includes(item)) {
      this.items = previousItems
      throw new Error('Недостаточно места в истории для сохранения версии.')
    }
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

  capture(): Promise<void> {
    if (this.captureTask || this.clearing || this.paused) return Promise.resolve()
    this.captureTask = this.captureSnapshot().finally(() => { this.captureTask = undefined })
    return this.captureTask
  }

  private async captureSnapshot(): Promise<void> {
    const epoch = this.epoch
    const baselineSequence = this.baselineSequence
    const sequence = baselineSequence === undefined ? undefined : this.clipboardSequence()
    if (baselineSequence !== undefined && sequence === undefined) return
    try {
      const snapshot = await this.deps.read()
      if (!snapshot || this.paused || this.epoch !== epoch) return
      if (sequence !== undefined && this.clipboardSequence() !== sequence) return
      const next = this.fingerprints(snapshot)
      if (this.clearBaseline === 'next-capture' && (baselineSequence === undefined || sequence === baselineSequence)) {
        this.rememberClipboard(next)
        this.error = snapshot.warning ?? null
        this.notify()
        return
      }
      if (this.previous?.text === next.text && this.previous.image === next.image && this.previous.files === next.files && this.previous.warning === next.warning) {
        // A later read can resolve the owner without changing the image bytes.
        const { image, imageSource } = snapshot
        const item = image && imageSource
          ? this.items.find(item => item.type === 'image' && item.data === image.data) : undefined
        if (item && imageSource && (item.params.source.name !== imageSource.name || item.params.source.title !== imageSource.title)) {
          item.params.source = imageSource
          item.params.tags = item.params.tags.map(tag => tag.code === 'source' ? { ...tag, value: imageSource.name } : tag)
          this.notify()
        }
        return
      }
      const textChanged = this.previous?.text !== next.text
      const imageChanged = this.previous?.image !== next.image
      const filesChanged = this.previous?.files !== next.files
      let source = UNKNOWN_SOURCE
      try { source = await this.deps.source() } catch { /* Source attribution is best effort. */ }
      const files = isFileUriList(snapshot.fileUris) ? snapshot.fileUris : undefined
      if (this.paused || this.epoch !== epoch) return
      // Relaunching while ClipClip owns focus must not downgrade a saved document's attribution.
      if (source === UNKNOWN_SOURCE && snapshot.text) {
        source = this.items.find(item => item.type !== 'image' && !item.fileUris && item.data === snapshot.text)?.params.source ?? source
      }
      this.rememberClipboard(next)
      this.error = snapshot.warning ?? null

      const add = (type: ClipboardKind, data: string, size: string, fileUris?: string[]) => {
        if (Buffer.byteLength(data, 'utf8') + (fileUris ? Buffer.byteLength(JSON.stringify(fileUris), 'utf8') : 0) > MAX_ITEM_BYTES) {
          this.error = 'Запись больше 8 МБ пропущена.'
          return
        }
        this.add(type, data, size, type === 'image' ? snapshot.imageSource ?? source : source, fileUris)
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
      if (this.paused || this.epoch !== epoch) return
      this.error = 'Не удалось прочитать буфер обмена. Проверка будет повторена.'
      this.notify()
    }
  }

  async setPaused(paused: boolean) {
    const request = ++this.pauseRequest
    if (paused) { this.updatePreferences(this.historyLimit, true); return }
    if (!this.paused) return
    const epoch = this.epoch
    try {
      const resume = await this.prepareResume()
      if (this.pauseRequest === request && this.epoch === epoch) this.updatePreferences(this.historyLimit, false, resume)
    } catch (error) {
      if (this.pauseRequest !== request || this.epoch !== epoch) return
      this.error = error instanceof Error ? error.message : 'Не удалось возобновить запись истории.'
      this.notify()
      throw error
    }
  }

  delete(id: string) {
    const index = this.items.findIndex(item => item.id === id)
    if (index < 0) return
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.deleted = { item: this.items[index], nextId: this.items[index + 1]?.id }
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
    const { item, nextId } = this.deleted
    const duplicate = this.items.find(existing => existing.id === item.id || matchesContent(existing, item.type, item.data, item.fileUris))
    const previous = this.items
    let restored = duplicate ?? item
    if (item.pinned && !duplicate?.pinned && previous.filter(existing => existing.pinned).length >= MAX_HISTORY_LIMIT) {
      throw new Error('Достигнут лимит избранных записей.')
    }
    if (duplicate) {
      if (item.pinned && !duplicate.pinned) {
        restored = { ...duplicate, pinned: true }
        this.items = previous.map(existing => existing === duplicate ? restored : existing)
      }
    } else {
      const successor = previous.findIndex(existing => existing.id === nextId && existing.createdAt === item.createdAt)
      this.items = [...previous]
      this.items.splice(successor < 0 ? previous.length : successor, 0, item)
      this.items.sort((left, right) => right.createdAt - left.createdAt)
    }
    this.trim()
    if (!this.items.includes(restored)) {
      this.items = previous
      throw new Error('Недостаточно места в истории для восстановления записи.')
    }
    this.deleted = null
    if (this.undoTimer) clearTimeout(this.undoTimer)
    this.undoTimer = null
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
