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
