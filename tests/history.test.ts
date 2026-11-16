import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClipboardHistory, ClipboardMonitor } from '../electron/main/history'
import { HISTORY_LIMIT, MAX_ITEM_BYTES, UNKNOWN_SOURCE, type ClipboardSnapshot } from '../shared/clipboard'

const source = async () => ({ name: 'Fixture: app', title: '' })
const image = { data: 'data:image/png;base64,aGVsbG8=', width: 2, height: 3 }
const active: ClipboardHistory[] = []
function setup(snapshot: ClipboardSnapshot = { text: 'hello', image: null }) {
  const read = vi.fn(async () => snapshot)
  const history = new ClipboardHistory({ read, source })
  active.push(history)
  return { history, read, setSnapshot: (value: ClipboardSnapshot) => { snapshot = value } }
}
afterEach(() => { active.splice(0).forEach(history => history.dispose()); vi.useRealTimers() })

describe('clipboard history', () => {
  it('merges imports by content, preserves existing IDs, resolves ID collisions and keeps favorites', async () => {
    const { history, setSnapshot, read } = setup()
    await history.capture()
    const original = { ...history.items[0], createdAt: 10 }
    setSnapshot({ text: 'removed', image: null }); await history.capture(); history.delete(history.items[0].id)
    const notify = vi.fn(); history.subscribe(notify)
    const reads = read.mock.calls.length
    const incoming = [{ ...original, id: 'duplicate', pinned: true },
      { ...original, data: 'new', createdAt: 20 }, { ...original, id: 'repeated', data: 'new' }]
    expect(history.importItems(incoming)).toEqual({ imported: 1, duplicates: 2, skipped: 0, removed: 0 })
    expect(history.items).toHaveLength(2)
    expect(history.items.find(item => item.data === 'hello')).toMatchObject({ id: original.id, pinned: true })
    expect(history.items.find(item => item.data === 'new')!.id).not.toBe(original.id)
    expect(history.canUndo).toBe(false)
    expect(notify).toHaveBeenCalledOnce()
    expect(read.mock.calls).toHaveLength(reads)
    await history.capture()
    expect(history.items).toHaveLength(2)
    expect(history.importItems(incoming)).toEqual({ imported: 0, duplicates: 3, skipped: 0, removed: 0 })
  })
  it('uses selected import settings and reports records omitted by count and byte budgets', async () => {
    const { history } = setup(); await history.capture()
    const original = history.items[0]
    history.setPinned(original.id, true)
    history.setHistoryLimit(1)
    const incoming = Array.from({ length: 3 }, (_, index) => ({ ...original, id: String(index), data: String(index), pinned: false, createdAt: index }))
    expect(history.importItems(incoming)).toEqual({ imported: 1, duplicates: 0, skipped: 2, removed: 0 })
    expect(history.historyLimit).toBe(1)
    history.importItems(incoming, { historyLimit: 3, paused: true })
    expect(history.items).toHaveLength(4)
    expect(history.paused).toBe(true)
    expect(history.historyLimit).toBe(3)
    history.hydrate(Array.from({ length: 4 }, (_, index) => ({ ...original, id: 'existing' + index, data: 'x'.repeat(MAX_ITEM_BYTES), pinned: true })))
    const result = history.importItems([{ ...original, id: 'incoming', data: 'new favorite', pinned: true, createdAt: Date.now() }])
    expect(result).toMatchObject({ imported: 0, skipped: 1, removed: 0 })
    expect(history.items.every(item => item.id.startsWith('existing'))).toBe(true)
  })
  it('discards captures already in flight when importing', async () => {
    let resolve!: (value: { name: string; title: string }) => void
    const slow = new ClipboardHistory({ read: () => ({ text: 'in flight', image: null }), source: () => new Promise(done => { resolve = done }) })
    active.push(slow)
    const { history } = setup(); await history.capture()
    const pending = slow.capture(); await Promise.resolve()
    slow.importItems(history.items)
    resolve({ name: 'fixture', title: '' }); await pending
    expect(slow.items.map(item => item.data)).toEqual(['hello'])
  })
  it('protects favorites from count eviction, recapture, restore and undo', async () => {
    const { history, setSnapshot } = setup({ text: 'favorite', image: null })
    await history.capture()
    const favorite = history.items[0]
    history.setPinned(favorite.id, true)
    history.setHistoryLimit(1)
    for (const text of ['old', 'new']) { setSnapshot({ text, image: null }); await history.capture() }
    expect(history.items.map(item => item.data)).toEqual(['new', 'favorite'])
    history.hydrate(history.items, false, 1)
    expect(history.items.find(item => item.id === favorite.id)?.pinned).toBe(true)
    setSnapshot({ text: 'favorite', image: null }); await history.capture()
    expect(history.items[0]).toMatchObject({ id: favorite.id, pinned: true })
    history.delete(favorite.id); history.undoDelete()
    expect(history.items.find(item => item.id === favorite.id)?.pinned).toBe(true)
    history.setPinned(favorite.id, false)
    expect(history.items).toHaveLength(1)
  })
  it('reserves the byte budget for favorites', async () => {
    const { history, setSnapshot } = setup()
    await history.capture()
    const original = history.items[0]
    history.hydrate(Array.from({ length: 4 }, (_, index) => ({ ...original, id: String(index), pinned: true, data: 'x'.repeat(MAX_ITEM_BYTES) })))
    setSnapshot({ text: 'ordinary', image: null }); await history.capture()
    expect(history.items).toHaveLength(4)
    expect(history.items.every(item => item.pinned)).toBe(true)
  })
  it('clears favorites and undo without recapturing the unchanged clipboard or altering settings', async () => {
    const { history, setSnapshot } = setup()
    await history.capture()
    history.setPinned(history.items[0].id, true)
    setSnapshot({ text: 'removed', image: null }); await history.capture()
    history.delete(history.items[0].id)
    history.setHistoryLimit(250); history.setPaused(true)
    await history.clear()
    expect(history.items).toEqual([])
    expect(history.canUndo).toBe(false)
    expect(history.paused).toBe(true)
    expect(history.historyLimit).toBe(250)
    history.undoDelete(); history.setPaused(false); await history.capture()
    expect(history.items).toEqual([])
    setSnapshot({ text: 'after clear', image: null }); await history.capture()
    expect(history.items[0].data).toBe('after clear')
  })
  it('cancels an in-flight attribution during clearing', async () => {
    let resolve!: (value: { name: string; title: string }) => void
    const slow = new ClipboardHistory({ read: () => ({ text: 'before clear', image: null }), source: () => new Promise(done => { resolve = done }) })
    active.push(slow)
    const pending = slow.capture(); await Promise.resolve()
    await slow.clear()
    resolve({ name: 'fixture', title: '' }); await pending; await slow.capture()
    expect(slow.items).toEqual([])
  })
  it('defaults to 100, applies a new cap immediately and uses it for captures, edits and undo', async () => {
    const { history, setSnapshot } = setup()
    expect(history.historyLimit).toBe(100)
    for (let index = 0; index < 105; index++) {
      setSnapshot({ text: 'entry ' + index, image: null })
      await history.capture()
    }
    expect(history.items).toHaveLength(100)
    const notify = vi.fn()
    history.subscribe(notify)
    history.setHistoryLimit(2)
    expect(history.items.map(item => item.data)).toEqual(['entry 104', 'entry 103'])
    expect(notify).toHaveBeenCalledOnce()
    history.setHistoryLimit(2)
    expect(notify).toHaveBeenCalledOnce()
    history.delete(history.items[1].id)
    setSnapshot({ text: 'latest', image: null }); await history.capture()
    history.undoDelete()
    expect(history.items).toHaveLength(2)
    history.saveTextRevision(history.items[0].id, 'edited')
    expect(history.items).toHaveLength(2)
    history.setHistoryLimit(4)
    setSnapshot({ text: 'new', image: null }); await history.capture()
    expect(history.items).toHaveLength(3)
  })
  it('validates caps and restores legacy or invalid settings with the default', () => {
    const { history } = setup()
    for (const limit of [0, -1, 1.5, 10_001, NaN, Infinity, '10', null, undefined]) {
      expect(() => history.setHistoryLimit(limit)).toThrow('лимит')
      history.hydrate([], false, limit)
      expect(history.historyLimit).toBe(100)
    }
    history.hydrate([], true, 250)
    expect(history.historyLimit).toBe(250)
    expect(history.paused).toBe(true)
    history.hydrate([])
    expect(history.historyLimit).toBe(100)
    history.setHistoryLimit(1)
    expect(history.historyLimit).toBe(1)
    history.setHistoryLimit(10_000)
    expect(history.historyLimit).toBe(10_000)
  })
  it('records copied paths as text, separately from the file, including after reload and recapture', async () => {
    const { history } = setup({ text: '', image: null, fileUris: ['file:///C:/Docs/report.pdf'] })
    await history.capture()
    const file = history.items[0]
    const copied = history.recordFilePathCopy('C:\\Docs\\report.pdf')
    expect(copied.type).toBe('text')
    expect(copied.params.tags).toContainEqual({ code: 'type', value: 'Текст' })
    expect(copied.fileUris).toBeUndefined()
    expect(history.items).toHaveLength(2)
    expect(history.items[1].id).toBe(file.id)
    expect(history.recordFilePathCopy(copied.data).id).toBe(copied.id)
    const restored = new ClipboardHistory({ read: () => ({ text: copied.data, image: null }), source })
    active.push(restored)
    restored.hydrate(history.items)
    await restored.capture()
    expect(restored.items[0].type).toBe('text')
    expect(restored.items[0].textOrigin).toBe('file-path')
    expect(restored.items[0].id).toBe(copied.id)
    expect(restored.items).toHaveLength(2)
  })
  it('records color copies, preserves the original, deduplicates and migrates old color tags', async () => {
    const { history, setSnapshot } = setup({ text: 'rgb(189, 189, 233)', image: null })
    await history.capture()
    const original = history.items[0]
    expect(original.type).toBe('color')
    const converted = history.recordColorCopy('#bdbde9')
    expect(history.items.map(item => item.data)).toEqual(['#bdbde9', 'rgb(189, 189, 233)'])
    expect(converted.params.tags).toContainEqual({ code: 'type', value: 'Цвет' })
    expect(converted.params.source.name).toBe('ClipClip')
    expect(history.recordColorCopy('#bdbde9').id).toBe(converted.id)
    setSnapshot({ text: '#bdbde9', image: null }); await history.capture()
    expect(history.items).toHaveLength(2)
    history.hydrate([{ ...original, type: 'text', params: { ...original.params, type: 'text', tags: [{ code: 'type', value: 'Текст' }] } }])
    expect(history.items[0].params.tags).toContainEqual({ code: 'type', value: 'Цвет' })
  })
  it('labels folders and files, persists their kinds and upgrades legacy unknown objects', async () => {
    const history = new ClipboardHistory({ read: () => ({ text: '', image: null, fileUris: ['file:///C:/folder', 'file:///C:/archive.zip'] }),
      source, fileKinds: async () => ['folder', 'file'] })
    active.push(history)
    await history.capture()
    expect(history.items[0].fileKinds).toEqual(['folder', 'file'])
    expect(history.items[0].params.size).toBe('1 файл, 1 папка')
    const record = history.items[0]
    history.hydrate([{ ...record, fileKinds: undefined }])
    history.updateFileKinds(record.id, ['folder', 'file'])
    expect(history.items[0].params.tags).toContainEqual({ code: 'size', value: '1 файл, 1 папка' })
    history.updateFileKinds(record.id, ['unknown', 'unknown'])
    expect(history.items[0].fileKinds).toEqual(['folder', 'file'])
    history.hydrate(history.items)
    expect(history.items[0].fileKinds).toEqual(['folder', 'file'])
  })
  it('prefers clipboard ownership for images while leaving text attribution unchanged', async () => {
    const imageSource = { name: 'Ножницы', title: '' }
    const { history } = setup({ text: 'ordinary text', image, imageSource })
    await history.capture()
    expect(history.items.find(item => item.type === 'image')?.params.source).toEqual(imageSource)
    expect(history.items.find(item => item.type === 'image')?.params.tags).toContainEqual({ code: 'source', value: 'Ножницы' })
    expect(history.items.find(item => item.type === 'text')?.params.source.name).toBe('Fixture: app')
  })
  it('falls back to the active source when an image has no clipboard owner attribution', async () => {
    const { history } = setup({ text: '', image })
    await history.capture()
    expect(history.items[0].params.source.name).toBe('Fixture: app')
  })
  it('preserves a saved image source when its owner is unavailable after relaunch', async () => {
    const imageSource = { name: 'Ножницы', title: '' }
    const { history } = setup({ text: '', image, imageSource })
    await history.capture()
    const original = history.items[0]
    const restored = new ClipboardHistory({ read: () => ({ text: '', image }), source: async () => UNKNOWN_SOURCE })
    active.push(restored)
    restored.hydrate(history.items)
    await restored.capture()
    expect(restored.items).toHaveLength(1)
    expect(restored.items[0]).toMatchObject({ id: original.id, params: { source: imageSource } })
    expect(restored.items[0].params.tags).toContainEqual({ code: 'source', value: 'Ножницы' })
  })
  it('enriches an unchanged image with a resolved owner without changing its position or timestamp', async () => {
    const { history, setSnapshot } = setup({ text: '', image })
    await history.capture()
    const { id, createdAt } = history.items[0]
    const imageSource = { name: 'Ножницы', title: '' }
    const notify = vi.fn(); history.subscribe(notify)
    setSnapshot({ text: '', image, imageSource })
    await history.capture()
    expect(history.items).toHaveLength(1)
    expect(history.items[0]).toMatchObject({ id, createdAt, params: { source: imageSource } })
    expect(history.items[0].params.tags).toContainEqual({ code: 'source', value: 'Ножницы' })
    expect(notify).toHaveBeenCalledOnce()
    await history.capture()
    expect(notify).toHaveBeenCalledOnce()
  })
  it('captures links and text from document sources with the right type and keeps versions editable', async () => {
    const { history, setSnapshot } = setup({ text: 'https://example.test', image: null })
    await history.capture()
    expect(history.items[0].type).toBe('link')
    const revision = history.saveTextRevision(history.items[0].id, 'ordinary text')
    expect(revision.type).toBe('text')
    setSnapshot({ text: 'C:\\Docs\\report.pdf', image: null })
    await history.capture()
    expect(history.items[0].params.tags).toContainEqual({ code: 'type', value: 'Документ' })
  })
  it('captures copied files separately, preserves metadata on reload, and prevents editing file paths', async () => {
    const fileUris = ['file:///C:/Docs/report.pdf', 'file:///C:/Docs/table.xlsx']
    const { history, setSnapshot } = setup({ text: 'file text representation', image, fileUris })
    await history.capture()
    expect(history.items).toHaveLength(1)
    expect(history.items[0].type).toBe('file')
    expect(history.items[0].fileUris).toEqual(fileUris)
    expect(history.items[0].data).toContain('C:\\Docs\\report.pdf')
    expect(() => history.saveTextRevision(history.items[0].id, 'edited path')).toThrow()
    history.hydrate(history.items)
    expect(history.items[0].fileUris).toEqual(fileUris)
    history.acknowledgeClipboard({ text: '', image: null, fileUris })
    setSnapshot({ text: '', image: null, fileUris }); await history.capture()
    expect(history.items).toHaveLength(1)
  })
  it.each([
    ['file:///C:/Downloads/archive.zip'], ['file:///C:/Tools/app.exe'], ['file:///C:/Projects/folder'],
    ['file:///C:/Projects/folder/', 'file:///C:/Downloads/archive.zip', 'file:///C:/Docs/report.pdf'],
    ['file:///C:/Images/photo.png'], ['file:///C:/Downloads/README'],
  ])('captures arbitrary files and folders: %s', async (...fileUris) => {
    const { history } = setup({ text: 'fallback', image, fileUris })
    await history.capture()
    expect(history.items).toHaveLength(1)
    expect(history.items[0].type).toBe('file')
    expect(history.items[0].fileUris).toEqual(fileUris)
    expect(history.items[0].params.tags).toContainEqual({ code: 'type', value: 'Файлы и папки' })
  })
  it('migrates legacy document file lists without changing their identity', async () => {
    const { history } = setup({ text: '', image: null, fileUris: ['file:///C:/Docs/report.pdf'] })
    await history.capture()
    const original = history.items[0]
    history.hydrate([{ ...original, type: 'document', params: { ...original.params, type: 'document',
      tags: [{ code: 'type', value: 'Документ' }] } }])
    expect(history.items[0].id).toBe(original.id)
    expect(history.items[0].type).toBe('file')
    expect(history.items[0].fileUris).toEqual(original.fileUris)
    expect(history.items[0].params.tags).toContainEqual({ code: 'type', value: 'Файлы и папки' })
  })
  it('reclassifies existing text without losing its id or source', async () => {
    const { history } = setup()
    await history.capture()
    const old = history.items[0]
    history.hydrate([{ ...old, data: 'https://example.test' }])
    expect(history.items[0].id).toBe(old.id)
    expect(history.items[0].type).toBe('link')
    expect(history.items[0].params.tags).toContainEqual({ code: 'type', value: 'Ссылка' })
  })
  it('keeps document attribution on restart when source lookup fails and deduplicates semantic types', async () => {
    let owner = { name: 'Microsoft Word', title: '' }
    let text = 'document paragraph'
    const history = new ClipboardHistory({ read: () => ({ text, image: null }), source: async () => {
      if (!owner.name) throw new Error('unavailable')
      return owner
    } })
    active.push(history)
    await history.capture()
    const original = history.items[0]
    const restored = new ClipboardHistory({ read: () => ({ text, image: null }), source: async () => { throw new Error('unavailable') } })
    active.push(restored)
    restored.hydrate(history.items); await restored.capture()
    expect(restored.items).toHaveLength(1)
    expect(restored.items[0].type).toBe('document')
    expect(restored.items[0].params.source.name).toBe('Microsoft Word')
    text = 'other'; await history.capture()
    owner = { name: 'Browser', title: '' }; text = 'document paragraph'; await history.capture()
    expect(history.items.filter(item => item.data === text)).toHaveLength(1)
    expect(history.items[0].id).toBe(original.id)
    expect(history.items[0].type).toBe('text')
  })
  it('preserves earlier text versions and resets without erasing edits', async () => {
    const { history } = setup()
    await history.capture()
    const original = history.items[0]
    const first = history.saveTextRevision(original.id, 'first edit')
    const second = history.saveTextRevision(first.id, 'second edit')
    const reset = history.saveTextRevision(second.id, original.data)
    expect(history.items.map(item => item.data)).toEqual(['hello', 'second edit', 'first edit'])
    expect(reset.id).toBe(original.id)
    expect(first.params.source).toEqual(original.params.source)
    expect(first.params.size).toBe('10 симв.')
  })
  it('permits an empty revision while paused and leaves the system clipboard untouched', async () => {
    const { history, read } = setup()
    await history.capture()
    history.setPaused(true)
    history.saveTextRevision(history.items[0].id, '')
    expect(history.items[0].data).toBe('')
    expect(read).toHaveBeenCalledTimes(1)
    expect(() => history.saveTextRevision('missing', 'edit')).toThrow()
  })
  it('keeps editing through history eviction and enforces revision limits', async () => {
    const { history } = setup()
    await history.capture()
    let id = history.items[0].id
    for (let index = 0; index < HISTORY_LIMIT + 10; index++) id = history.saveTextRevision(id, 'edit ' + index).id
    expect(history.items).toHaveLength(HISTORY_LIMIT)
    expect(() => history.saveTextRevision(id, 'x'.repeat(MAX_ITEM_BYTES + 1))).toThrow()
    expect(history.items[0].data).toBe('edit ' + (HISTORY_LIMIT + 9))
  })
  it('captures text and image once for an unchanged snapshot', async () => {
    const { history } = setup({ text: 'hello', image })
    for (let index = 0; index < 5; index++) await history.capture()
    expect(history.items.map(item => item.type)).toEqual(['image', 'text'])
  })
  it('ignores an empty image payload and still enforces the history limit', async () => {
    const { history, setSnapshot } = setup()
    for (let index = 0; index < HISTORY_LIMIT + 4; index++) {
      setSnapshot({ text: 'text-' + index, image: { ...image, data: 'data:image/png;base64,' } })
      await history.capture()
    }
    expect(history.items).toHaveLength(HISTORY_LIMIT)
    expect(history.items.every(item => item.type === 'text')).toBe(true)
  })
  it('serializes overlapping asynchronous clipboard reads', async () => {
    let resolve!: (snapshot: ClipboardSnapshot) => void
    const read = vi.fn(() => new Promise<ClipboardSnapshot>(done => { resolve = done }))
    const history = new ClipboardHistory({ read, source })
    active.push(history)
    const pending = history.capture()
    await history.capture()
    resolve({ text: 'hello', image: null })
    await pending
    expect(read).toHaveBeenCalledTimes(1)
    expect(history.items).toHaveLength(1)
  })
  it('recovers after a failed clipboard read without an unhandled rejection', async () => {
    const { history, read } = setup()
    read.mockRejectedValueOnce(new Error('fixture failure'))
    await expect(history.capture()).resolves.toBeUndefined()
    expect(history.error).toBeTruthy()
    await history.capture()
    expect(history.error).toBeNull()
    expect(history.items).toHaveLength(1)
  })
  it('reports skipped payloads even when the supported clipboard formats are unchanged', async () => {
    const { history, setSnapshot } = setup({ text: '', image: null })
    await history.capture()
    setSnapshot({ text: '', image: null, warning: 'Изображение больше 8 МБ пропущено.' })
    await history.capture()
    expect(history.error).toContain('8 МБ')
    setSnapshot({ text: '', image: null }); await history.capture()
    expect(history.error).toBeNull()
  })
  it('preserves IDs when a previously captured value is copied again', async () => {
    const { history, setSnapshot } = setup()
    await history.capture()
    const id = history.items[0].id
    setSnapshot({ text: 'other', image: null }); await history.capture()
    setSnapshot({ text: 'hello', image: null }); await history.capture()
    expect(history.items[0].id).toBe(id)
    expect(history.items).toHaveLength(2)
  })
  it('does not recapture an app-initiated copy', async () => {
    const { history, setSnapshot } = setup()
    await history.capture()
    const snapshot = { text: 'copied internally', image: null }
    setSnapshot(snapshot); history.acknowledgeClipboard(snapshot)
    await history.capture()
    expect(history.items[0].data).toBe('hello')
  })
  it('pauses even when a source lookup is already pending', async () => {
    let resolve!: (value: { name: string; title: string }) => void
    const history = new ClipboardHistory({ read: () => ({ text: 'hello', image: null }),
      source: () => new Promise(done => { resolve = done }) })
    active.push(history)
    const pending = history.capture()
    await Promise.resolve()
    history.setPaused(true)
    resolve({ name: 'fixture', title: '' })
    await pending
    expect(history.items).toHaveLength(0)
  })
  it('removes data from history and allows one bounded undo', async () => {
    vi.useFakeTimers()
    const { history } = setup()
    await history.capture()
    const id = history.items[0].id
    history.delete(id)
    expect(history.items).toEqual([])
    expect(history.canUndo).toBe(true)
    history.undoDelete()
    expect(history.items[0].id).toBe(id)
    history.delete(id)
    await vi.advanceTimersByTimeAsync(10_001)
    history.undoDelete()
    expect(history.items).toEqual([])
    expect(history.canUndo).toBe(false)
  })
  it('bounds oversized text without blocking subsequent captures', async () => {
    const { history, setSnapshot } = setup({ text: 'x'.repeat(MAX_ITEM_BYTES + 1), image: null })
    await history.capture()
    expect(history.items).toEqual([])
    expect(history.error).toContain('8 МБ')
    setSnapshot({ text: 'small', image: null }); await history.capture()
    expect(history.items).toHaveLength(1)
  })
  it('rejects invalid saved records and enforces the cap on restore', async () => {
    const { history, setSnapshot } = setup()
    for (let index = 0; index < HISTORY_LIMIT + 2; index++) { setSnapshot({ text: String(index), image: null }); await history.capture() }
    const items = [...history.items, { id: 'bad', data: '<invalid>' }, ...history.items]
    history.hydrate(items)
    expect(history.items).toHaveLength(HISTORY_LIMIT)
    expect(new Set(history.items.map(item => item.id)).size).toBe(HISTORY_LIMIT)
  })
  it('starts one polling loop, survives stop/start, and stops cleanly', async () => {
    vi.useFakeTimers()
    const { history, read } = setup()
    const monitor = new ClipboardMonitor(history)
    monitor.start(); monitor.start()
    await vi.advanceTimersByTimeAsync(1400)
    expect(read).toHaveBeenCalledTimes(3)
    monitor.stop()
    await vi.advanceTimersByTimeAsync(2100)
    expect(read).toHaveBeenCalledTimes(3)
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(4)
    monitor.stop()
  })
})
