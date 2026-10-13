// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
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
    setPreviewFullscreen: vi.fn(async () => {}), onPreviewFullscreenChanged: vi.fn(() => vi.fn()),
  }
  window.electronAPI = api
  const pinia = createPinia()
  setActivePinia(pinia)
  const buffer = useBufferStore()
  await buffer.connect()
  const wrapper = mount(Second, { attachTo: document.body, global: { plugins: [pinia] } })
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
  it.each([['.record-select', 'я'], ['.preview-button', '#'], ['header .icon-button', ' '], ['main', '🙂']])('starts search from %s without losing or duplicating %s', async (target, key) => {
    const { wrapper, api } = await setup()
    const element = wrapper.get(target).element as HTMLElement
    element.focus()
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.get('input').element.value).toBe(key)
    expect(document.activeElement).toBe(wrapper.get('input').element)
    expect(api.copyItem).not.toHaveBeenCalled()
    expect(api.setPaused).not.toHaveBeenCalled()
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled()
  })
  it('clears search and filters on Escape and returns focus from a list action', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('input').setValue('#text')
    await wrapper.get('.suggestions .tag-badge').trigger('click')
    await wrapper.get('input').setValue('fixture')
    const action = wrapper.get('.preview-button').element as HTMLButtonElement
    action.focus()
    await wrapper.get('.preview-button').trigger('keydown', { key: 'Escape' })
    expect(wrapper.get('input').element.value).toBe('')
    expect(wrapper.find('[aria-label="Выбранные фильтры"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('input').element)
    expect(api.hideWindow).not.toHaveBeenCalled()
  })
  it('focuses search on first show, every new invocation and return to the main window', async () => {
    const { wrapper } = await setup()
    const input = wrapper.get('input').element
    expect(document.activeElement).toBe(input)
    ;(wrapper.get('.preview-button').element as HTMLButtonElement).focus()
    window.dispatchEvent(new Event('focus'))
    expect(document.activeElement).toBe(input)
    await wrapper.get('input').setValue('fixture')
    emitShown(); await flushPromises()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('')
  })
  it('replaces the search selection and routes paste from outside the field', async () => {
    const { wrapper } = await setup()
    await wrapper.get('input').setValue('fixture')
    const input = wrapper.get('input').element
    input.setSelectionRange(1, 4)
    const action = wrapper.get('.preview-button').element as HTMLButtonElement
    action.focus()
    await wrapper.get('.preview-button').trigger('keydown', { key: 'A', shiftKey: true })
    expect(input.value).toBe('fAure')
    await wrapper.get('input').setValue('')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'pasted query' } })
    wrapper.get('main').element.dispatchEvent(paste)
    await flushPromises()
    expect(input.value).toBe('pasted query')
    expect(document.activeElement).toBe(input)
  })
  it('leaves document editing and its cursor keys outside the search shortcut', async () => {
    const { wrapper, api } = await setup([item('first'), item('second')])
    await wrapper.get('.preview-button').trigger('click'); await flushPromises()
    await wrapper.get('.edit-toggle').trigger('click'); await flushPromises()
    expect(wrapper.get('.preview-next').attributes('disabled')).toBeDefined()
    const input = wrapper.get('input').element
    const textarea = wrapper.get('textarea').element
    textarea.focus()
    await wrapper.get('textarea').trigger('keydown', { key: 'a' })
    await wrapper.get('textarea').trigger('keydown', { key: 'ArrowRight' })
    window.dispatchEvent(new Event('focus'))
    expect(document.activeElement).toBe(textarea)
    expect(input.value).toBe('')
    expect(api.copyItem).not.toHaveBeenCalled()
    expect(textarea.value).toContain('fixture')
  })
  it('navigates only within the same type across the whole history, counts that type, and preserves fullscreen', async () => {
    const first = item('first', 'first note'), second = item('second', 'second note'), excluded = item('excluded', 'outside')
    const image = item('image', 'data:image/png;base64,aGVsbG8=')
    image.type = image.params.type = 'image'
    second.params.source = { name: 'Other app', title: 'Second document window' }
    second.params.tags = [{ code: 'type', value: 'Текст' }, { code: 'source', value: 'Other app' }]
    const { wrapper, api } = await setup([first, image, second, excluded])
    await wrapper.get('input').setValue('note')
    await wrapper.get('.preview-button').trigger('click'); await flushPromises()
    expect(wrapper.get('.preview-previous').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#preview-title').text()).toBe('Текст(1/3)')
    expect(wrapper.find('.preview-navigation').exists()).toBe(false)
    await wrapper.get('.fullscreen-toggle').trigger('click'); await flushPromises()
    await wrapper.get('dialog').trigger('keydown', { key: 'ArrowRight' }); await flushPromises()
    expect(wrapper.get('.preview-content pre').text()).toBe('second note')
    expect(wrapper.get('.preview-metadata').text()).toContain('Other app')
    expect(wrapper.get('dialog').text()).toContain('Second document window')
    expect(wrapper.get('.preview-position').text()).toBe('(2/3)')
    expect(wrapper.get('.preview-next').attributes('disabled')).toBeUndefined()
    await wrapper.get('.preview-next').trigger('click'); await flushPromises()
    expect(wrapper.get('.preview-content pre').text()).toBe('outside')
    expect(wrapper.get('.preview-position').text()).toBe('(3/3)')
    expect(wrapper.get('.preview-next').attributes('disabled')).toBeDefined()
    expect(wrapper.get('dialog').classes()).toContain('is-fullscreen')
    expect(api.setPreviewFullscreen).toHaveBeenCalledTimes(1)
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
    await wrapper.get('.preview-previous').trigger('click'); await flushPromises()
    expect(wrapper.get('.preview-content pre').text()).toBe('second note')
    await wrapper.get('dialog').trigger('keydown', { key: 'ArrowLeft' }); await flushPromises()
    expect(wrapper.get('.preview-content pre').text()).toBe('first note')
    expect(api.copyItem).not.toHaveBeenCalled()
  })
  it('keeps single images in their type and puts navigation beside compact zoom controls without the wheel hint', async () => {
    const image = item('image', 'data:image/png;base64,aGVsbG8=')
    image.type = image.params.type = 'image'
    const { wrapper } = await setup([image, item('text')])
    await wrapper.get('.preview-button').trigger('click'); await flushPromises()
    expect(wrapper.get('#preview-title').text()).toBe('Изображение(1/1)')
    expect(wrapper.get('.preview-previous').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.preview-next').attributes('disabled')).toBeDefined()
    await wrapper.get('dialog').trigger('keydown', { key: 'ArrowRight' }); await flushPromises()
    expect(wrapper.find('.zoom-image').exists()).toBe(true)
    expect(wrapper.find('.preview-toolbar .zoom-fit').exists()).toBe(true)
    expect(wrapper.find('.preview-toolbar .preview-previous').exists()).toBe(true)
    expect(wrapper.find('.preview-toolbar .preview-next').exists()).toBe(true)
    expect(wrapper.get('dialog').text()).not.toContain('Ctrl + колесо')
  })
  it.each([['document', 'Документ', '#doc'], ['link', 'Ссылка', '#url']] as const)('searches, previews and copies %s records through English badges', async (kind, label, query) => {
    const record = item('special', kind === 'link' ? 'https://example.test' : 'document paragraph')
    record.type = record.params.type = kind
    record.params.tags = [{ code: 'type', value: label }]
    const { wrapper, api } = await setup([record, item('plain')])
    await wrapper.get('input').setValue(query)
    expect(wrapper.findAll('.record-select')).toHaveLength(1)
    expect(wrapper.get('.suggestions .tag-badge').text()).toBe(label)
    await wrapper.get('.suggestions .tag-badge').trigger('click')
    await wrapper.get('.preview-button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.preview-content pre').text()).toBe(record.data)
    await wrapper.get('dialog .primary-button').trigger('click')
    await flushPromises()
    expect(api.copyItem).toHaveBeenCalledWith('special')
    expect(api.hideWindow).toHaveBeenCalledTimes(1)
  })
  it('shows file names in cards and complete paths in a read-only document preview', async () => {
    const record = item('files', 'C:/Docs/report.pdf\nC:/Docs/table.xlsx')
    record.type = record.params.type = 'document'
    record.fileUris = ['file:///C:/Docs/report.pdf', 'file:///C:/Docs/table.xlsx']
    record.params.tags = [{ code: 'type', value: 'Документ' }]
    const { wrapper, api } = await setup([record])
    expect(wrapper.get('.text-preview').text()).toContain('report.pdf')
    expect(wrapper.get('.text-preview').text()).not.toContain('C:/Docs')
    await wrapper.get('.preview-button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.preview-content pre').text()).toContain('C:/Docs/report.pdf')
    expect(wrapper.find('.edit-toggle').exists()).toBe(false)
    await wrapper.get('dialog .primary-button').trigger('click')
    await flushPromises()
    expect(api.copyItem).toHaveBeenCalledWith('files')
    expect(api.saveTextRevision).not.toHaveBeenCalled()
  })
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
  it('applies and removes a suggested badge while returning focus to search', async () => {
    const other = item('other')
    other.params.source.name = 'Other app'
    other.params.tags = [{ code: 'source', value: 'Other app' }]
    const { wrapper } = await setup([item('first'), other])
    await wrapper.get('input').setValue('#Fixture')
    await wrapper.get('.suggestions .tag-badge').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.record-select')).toHaveLength(1)
    expect(wrapper.get('input').element.value).toBe('')
    expect(document.activeElement).toBe(wrapper.get('input').element)
    await wrapper.get('[aria-label="Выбранные фильтры"] .tag-badge').trigger('click')
    expect(wrapper.findAll('.record-select')).toHaveLength(2)
  })
  it('clears a query using the native clear button', async () => {
    const { wrapper } = await setup()
    await wrapper.get('input').setValue('no-match')
    await wrapper.get('[aria-label="Очистить поиск"]').trigger('click')
    expect(wrapper.get('input').element.value).toBe('')
    expect(wrapper.findAll('.record-select')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('input').element)
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
  it('toggles fullscreen by Ctrl+F on either keyboard layout and exits by Escape', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('.preview-button').trigger('click')
    await flushPromises()
    await wrapper.get('dialog').trigger('keydown', { key: 'а', code: 'KeyF', ctrlKey: true })
    await flushPromises()
    expect(api.setPreviewFullscreen).toHaveBeenLastCalledWith(true)
    expect(wrapper.get('dialog').classes()).toContain('is-fullscreen')
    await wrapper.get('dialog').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(api.setPreviewFullscreen).toHaveBeenLastCalledWith(false)
    expect(wrapper.get('dialog').classes()).not.toContain('is-fullscreen')
    expect(api.hideWindow).not.toHaveBeenCalled()
  })
  it('captures Escape outside the dialog and ignores repeat events after leaving fullscreen', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('.preview-button').trigger('click')
    await flushPromises()
    await wrapper.get('.fullscreen-toggle').trigger('click')
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(api.setPreviewFullscreen).toHaveBeenLastCalledWith(false)
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled()
    expect(api.hideWindow).not.toHaveBeenCalled()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1)
    expect(api.hideWindow).not.toHaveBeenCalled()
  })
  it('hides the compact window through its custom header button', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('.hide-window').trigger('click')
    expect(api.hideWindow).toHaveBeenCalledTimes(1)
  })
  it('restores the window on close and does not enter fullscreen outside a preview', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('input').trigger('keydown', { key: 'f', code: 'KeyF', ctrlKey: true })
    expect(api.setPreviewFullscreen).not.toHaveBeenCalled()
    await wrapper.get('.preview-button').trigger('click')
    await flushPromises()
    await wrapper.get('.fullscreen-toggle').trigger('click')
    await flushPromises()
    await wrapper.get('.close-preview').trigger('click')
    await flushPromises()
    expect(vi.mocked(api.setPreviewFullscreen).mock.calls.map(call => call[0])).toEqual([true, false])
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
  })
  it('keeps the preview usable after a failed fullscreen request', async () => {
    const { wrapper, api } = await setup()
    await wrapper.get('.preview-button').trigger('click')
    await flushPromises()
    vi.mocked(api.setPreviewFullscreen).mockRejectedValueOnce(new Error('fixture denied'))
    await wrapper.get('.fullscreen-toggle').trigger('click')
    await flushPromises()
    expect(wrapper.get('dialog').classes()).not.toContain('is-fullscreen')
    expect(wrapper.get('dialog [role="alert"]').text()).toContain('полноэкранный')
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
