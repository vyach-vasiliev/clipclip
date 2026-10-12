// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import { VBtn } from 'vuetify/components/VBtn'
import { VChip } from 'vuetify/components/VChip'
import { VIcon } from 'vuetify/components/VIcon'
import { VTextField } from 'vuetify/components/VTextField'
import { VAlert } from 'vuetify/components/VAlert'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import Second from '../src/components/Second.vue'
import { useBufferStore } from '../src/store/buffer'
import { adjacentId, filterHistory, highlightParts, historyTags } from '../src/utils/history'
import type { ClipboardHistoryItem, ElectronAPI, HistoryState } from '../shared/clipboard'

const wrappers: VueWrapper[] = []
let emitState: (state: HistoryState) => void
let emitShown: () => void
const item = (id: string, data = 'fixture [ bracket.\nsecond line'): ClipboardHistoryItem => ({
  id, type: 'text', data, createdAt: 1,
  params: { size: '20 симв.', type: 'text', source: { name: 'Fixture: app', title: '' },
    tags: [{ code: 'source', value: 'Fixture: app' }, { code: 'type', value: 'Текст' }] },
})
const state = (items = [item('first')], revision = 1): HistoryState => ({
  revision, items, paused: false, persistent: true, canUndo: false, shortcutAvailable: true, error: null,
})
async function setup(items?: ClipboardHistoryItem[]) {
  const api: ElectronAPI = {
    getHistory: vi.fn(async () => state(items)),
    onHistoryChanged: vi.fn(callback => { emitState = callback; return vi.fn() }),
    onWindowShown: vi.fn(callback => { emitShown = callback; return vi.fn() }),
    copyItem: vi.fn(async () => {}), deleteItem: vi.fn(async () => {}), undoDelete: vi.fn(async () => {}),
    saveTextRevision: vi.fn(async (_id, text) => item('edited', text)),
    setPaused: vi.fn(async () => {}), hideWindow: vi.fn(async () => {}),
  }
  window.electronAPI = api
  const pinia = createPinia()
  setActivePinia(pinia)
  const buffer = useBufferStore()
  await buffer.connect()
  const vuetify = createVuetify({ components: { VBtn, VChip, VIcon, VTextField, VAlert, VProgressLinear },
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } } })
  const wrapper = mount(Second, { attachTo: document.body, global: { plugins: [pinia, vuetify] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, api, buffer }
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
  HTMLDialogElement.prototype.showModal = vi.fn()
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ''; delete window.electronAPI; vi.unstubAllGlobals() })

describe('search and navigation', () => {
  it.each(['[', '.', '(', '\\', '<img>', '🙂'])('highlights literal %s without interpreting markup or regex', query => {
    const text = 'before ' + query + ' after'
    const parts = highlightParts(text, query)
    expect(parts.filter(part => part.matched).map(part => part.text)).toEqual([query])
    expect(parts.map(part => part.text).join('')).toBe(text)
  })
  it('keeps colon-containing tag values intact', () => {
    expect(historyTags([item('first')])[0].value).toBe('Fixture: app')
  })
  it('applies hash-prefixed filters and matches localized tag names', () => {
    expect(filterHistory([item('first')], '#Fixture: app', [])).toHaveLength(1)
    expect(filterHistory([item('first')], '#источник', [])).toHaveLength(1)
    expect(filterHistory([item('first')], '#absent', [])).toHaveLength(0)
  })
  it('returns no selection for an empty list', () => {
    expect(adjacentId([], null, 1)).toBeNull()
  })
  it('does not delete a record while editing the search field', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('input').trigger('keydown', { key: 'Delete' })
    expect(api.deleteItem).not.toHaveBeenCalled()
  })
  it('recovers selection after navigating an empty result set', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('input').setValue('no-match')
    await wrapper.get('input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.get('input').setValue('')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.copyItem).toHaveBeenCalledWith('first')
    expect(api.hideWindow).toHaveBeenCalledTimes(1)
  })
  it('preserves the identity of selection when new records arrive', async () => {
    const { wrapper, api } = await setup([item('first'), item('second')])
    await wrapper.get('#record-second').trigger('focus')
    emitState(state([item('new'), item('first'), item('second')], 2))
    await flushPromises()
    expect(wrapper.get('#record-second').attributes('aria-pressed')).toBe('true')
    await wrapper.get('#record-second').trigger('keydown', { key: 'Enter' })
    expect(api.copyItem).toHaveBeenCalledWith('second')
  })
  it('renders clipboard markup as text and safely highlights a bracket', async () => {
    const { wrapper } = await setup([item('first', '<img src=x onerror=alert(1)> [')])
    await wrapper.get('input').setValue('[')
    expect(wrapper.findAll('.text-preview img')).toHaveLength(0)
    expect(wrapper.get('mark').text()).toBe('[')
    expect(wrapper.get('.text-preview').text()).toContain('<img')
  })
  it('keeps the window open and reports a copy failure', async () => {
    const { wrapper, api } = await setup()
    vi.mocked(api.copyItem).mockRejectedValueOnce(new Error('fixture denied'))
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.hideWindow).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось скопировать')
  })
  it('waits for copy completion before hiding', async () => {
    const { wrapper, api } = await setup()
    let finish!: () => void
    vi.mocked(api.copyItem).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    expect(api.hideWindow).not.toHaveBeenCalled()
    finish(); await flushPromises()
    expect(api.hideWindow).toHaveBeenCalledTimes(1)
  })
  it('copies and hides with a single click on a record', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('.record-select').trigger('click')
    await flushPromises()
    expect(api.copyItem).toHaveBeenCalledWith('first')
    expect(api.hideWindow).toHaveBeenCalledTimes(1)
  })
  it('shows the full preview without copying', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('.preview-button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.preview-content pre').text()).toContain('second line')
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled()
    expect(api.copyItem).not.toHaveBeenCalled()
  })
  it('starts a new invocation with an empty search and the newest record', async () => {
    const { wrapper, api } = await setup([item('first'), item('second')])
    await wrapper.get('#record-second').trigger('focus')
    await wrapper.get('input').setValue('no-match')
    emitShown()
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.copyItem).toHaveBeenCalledWith('first')
  })
  it('ignores an older history snapshot', async () => {
    const { buffer } = await setup()
    emitState(state([item('new')], 5)); emitState(state([item('old')], 2))
    expect(buffer.clipboardHistory[0].id).toBe('new')
  })
})
