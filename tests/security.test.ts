import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assetPath, isTrustedPage, requireId, requireTextRevision } from '../electron/main/security'
import { MAX_ITEM_BYTES } from '../shared/clipboard'

describe('renderer trust boundary', () => {
  const entry = 'app://clipclip/index.html'
  it('permits the same document and hash routes', () => {
    expect(isTrustedPage(entry + '#/history', entry)).toBe(true)
    expect(isTrustedPage('http://127.0.0.1:3344/#/history', 'http://127.0.0.1:3344/')).toBe(true)
  })
  it.each(['https://example.com/index.html', 'app://other/index.html', 'app://clipclip/other.html',
    'app://user@clipclip/index.html', 'app://clipclip/index.html?remote=1', 'invalid'])('rejects %s', url => {
    expect(isTrustedPage(url, entry)).toBe(false)
  })
  it('keeps protocol assets inside the renderer root', () => {
    const root = path.resolve('fixture-dist')
    expect(assetPath('app://clipclip/assets/main.js', root)).toBe(path.join(root, 'assets/main.js'))
    expect(assetPath('app://clipclip/%2e%2e%2fsecret', root)).toBeNull()
    expect(assetPath('app://clipclip/%5csecret', root)).toBeNull()
    expect(assetPath('app://clipclip/%00secret', root)).toBeNull()
    expect(assetPath('https://example.com/index.html', root)).toBeNull()
  })
  it.each([null, '', {}, 'a'.repeat(101)])('rejects invalid IPC identifiers', id => {
    expect(() => requireId(id)).toThrow()
  })
  it('validates revision payloads and limits UTF-8 bytes', () => {
    expect(requireTextRevision({ id: 'one', text: '' })).toEqual({ id: 'one', text: '' })
    for (const payload of [null, { id: '' }, { id: 'one', text: 1 }, { id: 'one', text: 'я'.repeat(MAX_ITEM_BYTES / 2 + 1) }]) {
      expect(() => requireTextRevision(payload)).toThrow()
    }
  })
})
