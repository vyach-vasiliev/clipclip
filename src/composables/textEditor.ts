import { onBeforeUnmount, ref, watch } from 'vue'
import type { ClipboardHistoryItem } from '../../shared/clipboard'

export function useTextEditor(save: (id: string, text: string) => Promise<ClipboardHistoryItem>) {
  const draft = ref('')
  const editing = ref(false)
  const saving = ref(false)
  const saveError = ref('')
  const originalText = ref('')
  const savedText = ref('')
  const currentId = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<boolean> = Promise.resolve(true)

  function load(item: ClipboardHistoryItem) {
    clearTimeout(timer)
    editing.value = false
    currentId.value = item.id
    originalText.value = savedText.value = draft.value = item.data
    saveError.value = ''
  }
  function flush(): Promise<boolean> {
    clearTimeout(timer)
    const text = draft.value
    queue = queue.then(async () => {
      if (!currentId.value || text === savedText.value) return true
      saving.value = true
      saveError.value = ''
      try {
        const item = await save(currentId.value, text)
        currentId.value = item.id
        savedText.value = text
        return true
      } catch {
        saveError.value = 'Версия не сохранена. Текст остаётся в редакторе — попробуйте ещё раз.'
        return false
      } finally { saving.value = false }
    })
    return queue
  }
  watch(draft, () => {
    clearTimeout(timer)
    if (editing.value) timer = setTimeout(() => { void flush() }, 700)
  }, { flush: 'sync' })
  async function toggle() {
    if (editing.value && !await flush()) return
    editing.value = !editing.value
  }
  async function reset() {
    // Preserve the current draft as a version before restoring the original.
    if (!await flush()) return
    draft.value = originalText.value
    await flush()
  }
  onBeforeUnmount(() => { clearTimeout(timer) })
  return { draft, editing, saving, saveError, originalText, savedText, currentId, load, flush, toggle, reset }
}
