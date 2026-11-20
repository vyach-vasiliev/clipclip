import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ClipboardHistoryItem, FileCheckResult, HistoryState, ItemActivationResult } from '../../shared/clipboard'
import { HISTORY_LIMIT } from '../../shared/clipboard'
import type { ColorFormat } from '../../shared/colors'
import { DEFAULT_SHORTCUTS, type ShortcutSettings } from '../../shared/shortcuts'
import type { BackupResult } from '../../shared/backup'
import { DEFAULT_TIME_FORMAT, type TimeFormat } from '../../shared/time'

type PasteFailure = Extract<ItemActivationResult, { status: 'paste-unavailable' }>

export const useBufferStore = defineStore('buffer', () => {
  const clipboardHistory = ref<ClipboardHistoryItem[]>([])
  const loading = ref(true)
  const paused = ref(false)
  const historyLimit = ref(HISTORY_LIMIT)
  const pasteOnSelect = ref(true)
  const pasteAvailable = ref(false)
  const pasteOnSelectActive = computed(() => pasteAvailable.value && pasteOnSelect.value)
  const promoteCopiedRecords = ref(true)
  const timeFormat = ref<TimeFormat>(DEFAULT_TIME_FORMAT)
  const shortcuts = ref<ShortcutSettings>({ ...DEFAULT_SHORTCUTS })
  const persistent = ref(false)
  const shortcutAvailable = ref(true)
  const canUndo = ref(false)
  const latestError = ref<string | null>(null)
  const pasteFailure = ref<PasteFailure | null>(null)
  const error = computed({
    get: () => pasteFailure.value?.message ?? latestError.value,
    set: (value: string | null) => {
      pasteFailure.value = null
      latestError.value = value
    },
  })
  const pasteWarning = computed(() => pasteFailure.value?.canPasteManually === true)
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
    historyLimit.value = state.historyLimit
    pasteOnSelect.value = state.pasteOnSelect
    pasteAvailable.value = state.pasteAvailable
    promoteCopiedRecords.value = state.promoteCopiedRecords
    timeFormat.value = state.timeFormat
    shortcuts.value = state.shortcuts
    persistent.value = state.persistent
    shortcutAvailable.value = state.shortcutAvailable
    canUndo.value = state.canUndo
    latestError.value = state.error
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

  async function action(operation: () => Promise<void | string | PasteFailure>, failure: string): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = null
    try {
      const message = await operation()
      if (message) {
        if (typeof message === 'string') error.value = message
        else pasteFailure.value = message
        return false
      }
      return true
    }
    catch { error.value = failure; return false }
    finally { busy.value = false }
  }

  const copy = (id: string, onFileCheck?: (id: string, result: FileCheckResult) => void, activate = false) => action(
    async () => {
      const result = await (activate ? window.electronAPI!.activateItem(id) : window.electronAPI!.copyItem(id))
      if (result && result.status === 'paste-unavailable') return result
      if (clipboardHistory.value.some(item => item.id === id && item.fileUris)) {
        onFileCheck?.(id, result ?? { status: 'available', message: 'Все файлы и папки доступны.' })
      }
      if (result && result.status !== 'available') return result.message
    }, 'Не удалось скопировать запись.',
  )
  async function copyColor(id: string, format: ColorFormat): Promise<ClipboardHistoryItem | null> {
    let copied: ClipboardHistoryItem | null = null
    await action(async () => { copied = await window.electronAPI!.copyColor(id, format) }, 'Не удалось скопировать цвет. Попробуйте ещё раз.')
    return copied
  }
  const revealFile = (id: string, index: number) => action(async () => {
    const result = await window.electronAPI!.revealFile(id, index)
    if (result.status !== 'available') return result.message
  }, 'Не удалось открыть файл или папку в Проводнике.')
  async function copyFilePath(id: string, index: number): Promise<ClipboardHistoryItem | null> {
    let copied: ClipboardHistoryItem | null = null
    await action(async () => { copied = await window.electronAPI!.copyFilePath(id, index) }, 'Не удалось скопировать путь. Попробуйте ещё раз.')
    return copied
  }
  const remove = (id: string) => action(
    () => window.electronAPI!.deleteItem(id), 'Не удалось удалить запись.',
  )
  const undo = () => action(() => window.electronAPI!.undoDelete(), 'Не удалось отменить удаление.')
  const setPaused = (value: boolean) => action(
    () => window.electronAPI!.setPaused(value), 'Не удалось изменить состояние записи.',
  )
  const hide = () => action(() => window.electronAPI!.hideWindow(), 'Не удалось скрыть окно.')
  const setHistoryLimit = (value: number, maxRemoved?: number) => action(
    () => maxRemoved === undefined ? window.electronAPI!.setHistoryLimit(value) : window.electronAPI!.setHistoryLimit(value, maxRemoved),
    'Не удалось изменить лимит истории.',
  )
  const setPasteOnSelect = (value: boolean) => action(
    () => window.electronAPI!.setPasteOnSelect(value), 'Не удалось изменить настройку вставки.',
  )
  const setPromoteCopiedRecords = (value: boolean) => action(
    () => window.electronAPI!.setPromoteCopiedRecords(value), 'Не удалось изменить настройку порядка записей.',
  )
  const setTimeFormat = (value: TimeFormat) => action(
    () => window.electronAPI!.setTimeFormat(value), 'Не удалось изменить формат времени.',
  )
  const resetSettings = () => action(
    () => window.electronAPI!.resetSettings(), 'Не удалось сбросить настройки. Стандартное сочетание вызова окна может быть занято.',
  )
  const setPinned = (id: string, pinned: boolean) => action(
    () => window.electronAPI!.setPinned(id, pinned), 'Не удалось изменить избранное.',
  )
  const clearHistory = () => action(() => window.electronAPI!.clearHistory(), 'Не удалось очистить историю.')
  async function transferHistory(mode: 'import' | 'export', includeSettings = false): Promise<BackupResult | null> {
    let result: BackupResult | null = null
    await action(async () => {
      result = mode === 'export' ? await window.electronAPI!.exportHistory() : await window.electronAPI!.importHistory(includeSettings)
      if (result.status === 'error') return result.message
    }, mode === 'export' ? 'Не удалось экспортировать историю.' : 'Не удалось импортировать историю.')
    return result
  }
  const setShortcuts = (value: ShortcutSettings) => action(
    () => window.electronAPI!.setShortcuts(value), 'Не удалось применить горячие клавиши. Сочетание вызова окна может быть занято другой программой.',
  )
  const saveRevision = (id: string | null, text: string) => window.electronAPI!.saveTextRevision(id, text)
  const setFullscreen = (value: boolean) => action(
    () => window.electronAPI!.setPreviewFullscreen(value), 'Не удалось переключить полноэкранный режим.',
  )

  return { clipboardHistory, loading, paused, historyLimit, pasteOnSelect, pasteAvailable, pasteOnSelectActive, promoteCopiedRecords, timeFormat, shortcuts, persistent, shortcutAvailable, canUndo, error, pasteWarning,
    busy, connect, disconnect, copy, copyColor, revealFile, copyFilePath, remove, undo, setPaused, setHistoryLimit, setPasteOnSelect, setPromoteCopiedRecords, setTimeFormat, resetSettings, setPinned, clearHistory, transferHistory, setShortcuts, hide, saveRevision, setFullscreen }
})
