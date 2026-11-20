// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { useTextEditor } from '../src/composables/textEditor'
import type { ClipboardHistoryItem } from '../shared/clipboard'

const item = (id: string, data: string): ClipboardHistoryItem => ({ id, data, type: 'text', createdAt: 1,
  params: { size: data.length + ' симв.', type: 'text', source: { name: 'Fixture', title: '' }, tags: [] } })
const wrappers: ReturnType<typeof mount>[] = []
function setup(save = vi.fn(async (_id: string | null, text: string) => item(text, text))) {
  let editor!: ReturnType<typeof useTextEditor>
  const wrapper = mount(defineComponent({ setup() { editor = useTextEditor(save); return () => null } }))
  wrappers.push(wrapper)
  editor.load(item('original', 'hello'))
  return { editor, save }
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers() })

describe('text version editor', () => {
  it('saves coherent versions after a pause rather than every keystroke', async () => {
    vi.useFakeTimers()
    const { editor, save } = setup()
    await editor.toggle()
    editor.draft.value = 'first'
    await vi.advanceTimersByTimeAsync(400)
    editor.draft.value = 'first edit'
    await vi.advanceTimersByTimeAsync(700)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('original', 'first edit')
    editor.draft.value = 'second'
    await editor.flush()
    expect(save).toHaveBeenLastCalledWith('first edit', 'second')
  })
  it('saves the unsaved draft before reset and then saves the original', async () => {
    const { editor, save } = setup()
    await editor.toggle()
    editor.draft.value = 'unsaved version'
    await editor.reset()
    expect(save.mock.calls.map(call => call[1])).toEqual(['unsaved version', 'hello'])
    expect(editor.draft.value).toBe('hello')
  })
  it('serializes pending saves and preserves changes typed during a request', async () => {
    let finish!: (item: ClipboardHistoryItem) => void
    const save = vi.fn(async (_id: string | null, text: string) => item(text, text))
    save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { editor } = setup(save)
    await editor.toggle()
    editor.draft.value = 'first'
    const first = editor.flush()
    await flushPromises()
    editor.draft.value = 'second'
    const second = editor.flush()
    finish(item('first-id', 'first'))
    await Promise.all([first, second])
    expect(save.mock.calls).toEqual([['original', 'first'], ['first-id', 'second']])
  })
  it('keeps failed drafts available for retry and refuses to disable editing', async () => {
    const { editor, save } = setup()
    await editor.toggle()
    editor.draft.value = 'keep this'
    save.mockRejectedValueOnce(new Error('fixture failure'))
    await editor.toggle()
    expect(editor.editing.value).toBe(true)
    expect(editor.draft.value).toBe('keep this')
    expect(editor.saveError.value).toBeTruthy()
    expect(await editor.flush()).toBe(true)
    expect(editor.saveError.value).toBe('')
  })
  it('preserves a failed draft and supports saving it as a standalone record', async () => {
    const { editor, save } = setup()
    await editor.toggle()
    editor.draft.value = 'recover this'
    save.mockRejectedValueOnce(new Error('source evicted'))
    expect(await editor.flush()).toBe(false)
    expect(editor.savedText.value).toBe('hello')
    expect(await editor.saveAsNew()).toBe(true)
    expect(save.mock.calls).toEqual([['original', 'recover this'], [null, 'recover this']])
    expect(editor.currentId.value).toBe('recover this')
    expect(editor.savedText.value).toBe('recover this')
  })
  it('discards a draft and cancels its pending autosave', async () => {
    vi.useFakeTimers()
    const { editor, save } = setup()
    await editor.toggle()
    editor.draft.value = 'discard this'
    editor.discard()
    await vi.advanceTimersByTimeAsync(700)
    expect(save).not.toHaveBeenCalled()
    expect(editor.draft.value).toBe('hello')
    expect(editor.editing.value).toBe(false)
  })
})
