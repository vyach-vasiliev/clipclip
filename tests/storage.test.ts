import { mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EncryptedHistoryStorage, MAX_ENCRYPTED_HISTORY_BYTES, type HistoryEncryption } from '../electron/main/storage'
import { DEFAULT_SHORTCUTS } from '../shared/shortcuts'
import { ClipboardHistory } from '../electron/main/history'

const directories: string[] = []
async function setup(crypto?: HistoryEncryption) {
  const directory = await mkdtemp(path.join(tmpdir(), 'clipclip-storage-test-'))
  directories.push(directory)
  const file = path.join(directory, 'history.enc')
  const storage = new EncryptedHistoryStorage(file, crypto ?? {
    encrypt: async text => Buffer.from('fixture:' + Buffer.from(text).toString('base64')),
    decrypt: async bytes => {
      const value = bytes.toString()
      if (!value.startsWith('fixture:')) throw new Error('Invalid ciphertext')
      return Buffer.from(value.slice(8), 'base64').toString()
    },
  })
  return { storage, file }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
describe('encrypted persistence', () => {
  it('starts with an empty history if no file exists', async () => {
    const { storage } = await setup()
    expect(await storage.load()).toEqual({ items: [], paused: false })
  })
  it('writes encrypted bytes and restores a paused state', async () => {
    const { storage, file } = await setup()
    await storage.save({ items: [], paused: true })
    expect((await readFile(file)).toString()).not.toContain('paused')
    expect(await storage.load()).toEqual({ items: [], paused: true })
  })
  it('persists the selected cap with encrypted history', async () => {
    const { storage } = await setup()
    const state = { items: [], paused: false, historyLimit: 250, timeFormat: '12h' as const, pasteOnSelect: false, promoteCopiedRecords: false }
    await storage.save(state)
    expect(await storage.load()).toEqual(state)
  })
  it('round-trips favorites and custom shortcuts with the encrypted history', async () => {
    const { storage } = await setup()
    const history = new ClipboardHistory({ read: () => ({ text: 'synthetic favorite', image: null }), source: async () => ({ name: 'Fixture', title: '' }) })
    await history.capture()
    history.setPinned(history.items[0].id, true)
    const shortcuts = { ...DEFAULT_SHORTCUTS, openWindow: 'Ctrl+Shift+Q' }
    await storage.save({ items: history.items, paused: false, historyLimit: 1, shortcuts })
    const restored = await storage.load()
    history.hydrate(restored.items, restored.paused, restored.historyLimit)
    expect(history.items[0].pinned).toBe(true)
    expect(restored.shortcuts).toEqual(shortcuts)
    history.dispose()
  })
  it('keeps cleared clipboard content out of history after reopening encrypted storage', async () => {
    const { storage } = await setup()
    let text = 'fixture to clear'
    const deps = { read: () => ({ text, image: null }), source: async () => ({ name: 'Fixture', title: '' }) }
    const history = new ClipboardHistory(deps)
    await history.capture()
    await history.clear()
    await storage.save({ items: history.items, paused: history.paused, clipboardClearBaseline: history.clipboardClearBaseline })
    history.dispose()

    const restored = await storage.load()
    const restarted = new ClipboardHistory(deps)
    try {
      restarted.hydrate(restored.items, restored.paused, restored.historyLimit, restored.clipboardClearBaseline)
      await restarted.capture()
      expect(restarted.items).toEqual([])
      text = 'fixture copied after restart'
      await restarted.capture()
      expect(restarted.items.map(item => item.data)).toEqual([text])
    } finally { restarted.dispose() }
  })
  it('serializes rapid updates so older saves cannot overwrite newer ones', async () => {
    const { storage } = await setup()
    await Promise.all([storage.save({ items: [], paused: false }), storage.save({ items: [], paused: true })])
    await storage.flush()
    expect((await storage.load()).paused).toBe(true)
  })
  it('keeps the existing file if the staged commit fails revalidation', async () => {
    const { storage, file } = await setup()
    await storage.save({ items: [], paused: false, historyLimit: 100 })
    await expect(storage.save({ items: [], paused: true, historyLimit: 1 }, () => {
      throw new Error('fixture: state changed')
    })).rejects.toThrow('state changed')
    expect(await storage.load()).toEqual({ items: [], paused: false, historyLimit: 100 })
    expect(await readdir(path.dirname(file))).toEqual(['history.enc'])
    await storage.save({ items: [], paused: true, historyLimit: 2 }, async replace => {
      expect((await storage.load()).historyLimit).toBe(100)
      replace()
    })
    expect(await storage.load()).toEqual({ items: [], paused: true, historyLimit: 2 })
  })
  it('restores a supported history that expands beyond 64 MiB when serialized', async () => {
    const { storage, file } = await setup({
      encrypt: async text => Buffer.from(text),
      decrypt: async bytes => bytes.toString(),
    })
    let text = ''
    const history = new ClipboardHistory({ read: () => ({ text, image: null }), source: async () => ({ name: 'Fixture', title: '' }) })
    try {
      for (const suffix of ['one', 'two']) {
        text = '\u0001'.repeat(6 * 1024 * 1024) + suffix
        await history.capture()
      }
      expect(history.items).toHaveLength(2)
      await storage.save({ items: history.items, paused: false })
      expect((await stat(file)).size).toBeGreaterThan(64 * 1024 * 1024)
      expect((await storage.load()).items).toEqual(history.items)
    } finally { history.dispose() }
  })
  it('keeps the previous readable file when encryption exceeds the shared limit', async () => {
    const { storage, file } = await setup({
      encrypt: async text => JSON.parse(text).paused ? Buffer.alloc(MAX_ENCRYPTED_HISTORY_BYTES + 1) : Buffer.from(text),
      decrypt: async bytes => bytes.toString(),
    })
    await storage.save({ items: [], paused: false })
    let readyToCommit = false
    await expect(storage.save({ items: [], paused: true }, () => { readyToCommit = true })).rejects.toThrow('слишком велика')
    expect(readyToCommit).toBe(false)
    expect((await storage.load()).paused).toBe(false)
    expect((await stat(file)).size).toBeLessThan(1024)
  })
  it('reports a corrupt file without exposing its contents', async () => {
    const { storage, file } = await setup()
    await writeFile(file, 'secret fixture invalid')
    await expect(storage.load()).rejects.toThrow('Не удалось открыть')
  })
})
