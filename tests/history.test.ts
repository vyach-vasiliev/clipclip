import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClipboardHistory, ClipboardMonitor } from '../electron/main/history'
import { HISTORY_LIMIT, MAX_ITEM_BYTES, type ClipboardSnapshot } from '../shared/clipboard'

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
    expect(history.items[0].type).toBe('document')
    expect(history.items[0].fileUris).toEqual(fileUris)
    expect(history.items[0].data).toContain('C:/Docs/report.pdf')
    expect(() => history.saveTextRevision(history.items[0].id, 'edited path')).toThrow()
    history.hydrate(history.items)
    expect(history.items[0].fileUris).toEqual(fileUris)
    history.acknowledgeClipboard({ text: '', image: null, fileUris })
    setSnapshot({ text: '', image: null, fileUris }); await history.capture()
    expect(history.items).toHaveLength(1)
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
    for (let index = 0; index < 20; index++) id = history.saveTextRevision(id, 'edit ' + index).id
    expect(history.items).toHaveLength(HISTORY_LIMIT)
    expect(() => history.saveTextRevision(id, 'x'.repeat(MAX_ITEM_BYTES + 1))).toThrow()
    expect(history.items[0].data).toBe('edit 19')
  })
  it('captures text and image once for an unchanged snapshot', async () => {
    const { history } = setup({ text: 'hello', image })
    for (let index = 0; index < 5; index++) await history.capture()
    expect(history.items.map(item => item.type)).toEqual(['image', 'text'])
  })
  it('ignores an empty image payload and still enforces the history limit', async () => {
    const { history, setSnapshot } = setup()
    for (let index = 0; index < 14; index++) {
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
    for (let index = 0; index < 12; index++) { setSnapshot({ text: String(index), image: null }); await history.capture() }
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
