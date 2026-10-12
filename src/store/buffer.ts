import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ClipboardHistoryItem, HistoryState } from '../../shared/clipboard'

export const useBufferStore = defineStore('buffer', () => {
  const clipboardHistory = ref<ClipboardHistoryItem[]>([])
  const loading = ref(true)
  const paused = ref(false)
  const persistent = ref(false)
  const shortcutAvailable = ref(true)
  const canUndo = ref(false)
  const error = ref<string | null>(null)
  const busy = ref(false)
  let revision = -1
  let unsubscribe: (() => void) | undefined
  let connecting: Promise<void> | undefined
  let generation = 0

  function apply(state: HistoryState) {
    if (state.revision < revision) return
    revision = state.revision
    clipboardHistory.value = state.items
    paused.value = state.paused
    persistent.value = state.persistent
    shortcutAvailable.value = state.shortcutAvailable
    canUndo.value = state.canUndo
    error.value = state.error
    loading.value = false
  }

  function connect(): Promise<void> {
    if (connecting) return connecting
    const currentGeneration = ++generation
    const api = window.electronAPI
    if (!api) {
      error.value = 'История доступна в настольном приложении ClipClip.'
      loading.value = false
      return Promise.resolve()
    }
    unsubscribe = api.onHistoryChanged(state => { if (generation === currentGeneration) apply(state) })
    connecting = api.getHistory().then(state => {
      if (generation === currentGeneration) apply(state)
    }).catch(() => {
      if (generation !== currentGeneration) return
      error.value = 'Не удалось загрузить историю. Попробуйте открыть окно ещё раз.'
      loading.value = false
    })
    return connecting!
  }

  function disconnect() {
    generation++
    unsubscribe?.()
    unsubscribe = undefined
    connecting = undefined
    revision = -1
  }

  async function action(operation: () => Promise<void>, failure: string): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = null
    try { await operation(); return true }
    catch { error.value = failure; return false }
    finally { busy.value = false }
  }

  const copy = (id: string) => action(
    () => window.electronAPI!.copyItem(id), 'Не удалось скопировать запись. Попробуйте ещё раз.',
  )
  const remove = (id: string) => action(
    () => window.electronAPI!.deleteItem(id), 'Не удалось удалить запись.',
  )
  const undo = () => action(() => window.electronAPI!.undoDelete(), 'Не удалось отменить удаление.')
  const setPaused = (value: boolean) => action(
    () => window.electronAPI!.setPaused(value), 'Не удалось изменить состояние записи.',
  )
  const hide = () => action(() => window.electronAPI!.hideWindow(), 'Не удалось скрыть окно.')

  return { clipboardHistory, loading, paused, persistent, shortcutAvailable, canUndo, error,
    busy, connect, disconnect, copy, remove, undo, setPaused, hide }
})
