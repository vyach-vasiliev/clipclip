import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EncryptedHistoryStorage } from '../electron/main/storage'

const directories: string[] = []
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'clipclip-storage-test-'))
  directories.push(directory)
  const file = path.join(directory, 'history.enc')
  const storage = new EncryptedHistoryStorage(file, {
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
    await storage.save({ items: [], paused: false, historyLimit: 250 })
    expect(await storage.load()).toEqual({ items: [], paused: false, historyLimit: 250 })
  })
  it('serializes rapid updates so older saves cannot overwrite newer ones', async () => {
    const { storage } = await setup()
    await Promise.all([storage.save({ items: [], paused: false }), storage.save({ items: [], paused: true })])
    await storage.flush()
    expect((await storage.load()).paused).toBe(true)
  })
  it('reports a corrupt file without exposing its contents', async () => {
    const { storage, file } = await setup()
    await writeFile(file, 'secret fixture invalid')
    await expect(storage.load()).rejects.toThrow('Не удалось открыть')
  })
})
