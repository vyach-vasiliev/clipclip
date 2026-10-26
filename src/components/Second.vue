<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { mdiContentCopy, mdiDeleteOutline, mdiPause, mdiPlay, mdiUndo, mdiClipboardTextOutline, mdiEyeOutline, mdiClose, mdiPencilOutline, mdiRestore, mdiCheck, mdiFullscreen, mdiFullscreenExit, mdiPlus, mdiMinus, mdiFitToScreenOutline, mdiChevronLeft, mdiChevronRight, mdiAlertCircleOutline } from '@mdi/js'
import { HISTORY_LIMIT, KIND_LABELS, TAG_LABELS, type ClipboardKind, type ClipboardHistoryItem, type ClipboardTag } from '../../shared/clipboard'
import { useBufferStore } from '../store/buffer'
import { adjacentId, filterHistory, highlightParts, historyTags, isEditingTarget, isActionTarget } from '../utils/history'
import SearchPanel from './SearchPanel.vue'
import AppIcon from './AppIcon.vue'
import TagBadge from './TagBadge.vue'
import { useTextEditor } from '../composables/textEditor'
import { useImageZoom } from '../composables/imageZoom'
import { useFileAvailability } from '../composables/fileAvailability'
import { colorSwatch } from '../../shared/colors'
import ColorConverter from './ColorConverter.vue'
import FileLocations from './FileLocations.vue'
import FileActions from './FileActions.vue'

const buffer = useBufferStore()
const search = ref('')
const selectedTags = ref<ClipboardTag[]>([])
const selectedId = ref<string | null>(null)
const searchPanel = ref<InstanceType<typeof SearchPanel>>()
const announcement = ref('')
const copyingId = ref<string | null>(null)
const previewDialog = ref<HTMLDialogElement>()
const previewId = ref<string | null>(null)
const preview = computed(() => buffer.clipboardHistory.find(item => item.id === previewId.value))
const editor = useTextEditor(buffer.saveRevision)
const { draft, editing, saving, saveError, originalText, savedText } = editor
const textArea = ref<HTMLTextAreaElement>()
const previewKind = ref<ClipboardKind>('text')
const previewFiles = ref(false)
const previewIsText = computed(() => previewKind.value !== 'image' && !previewFiles.value)
const previewOpen = ref(false)
const colorItem = ref<ClipboardHistoryItem | null>(null)
const fileAction = ref<{ item: ClipboardHistoryItem; index: number } | null>(null)
function openFileActions(item: ClipboardHistoryItem, index: number) {
  select(item)
  fileAction.value = { item, index }
}
const colors = computed(() => Object.fromEntries(buffer.clipboardHistory
  .filter(item => item.type !== 'image' && !item.fileUris)
  .map(item => [item.id, colorSwatch(item.data)])))
function openColor(item: ClipboardHistoryItem) { select(item); colorItem.value = item }
watch(() => buffer.clipboardHistory, items => {
  if (!buffer.busy && colorItem.value && !items.some(item => item.id === colorItem.value?.id && item.data === colorItem.value?.data)) colorItem.value = null
  if (!buffer.busy && fileAction.value && !items.some(item => item.id === fileAction.value?.item.id)) fileAction.value = null
})
async function colorCopied(item: ClipboardHistoryItem) {
  colorItem.value = null
  await selectCopied(item, 'Цвет скопирован и добавлен в историю.')
}
async function pathCopied(item: ClipboardHistoryItem) {
  fileAction.value = null
  await selectCopied(item, 'Путь скопирован и добавлен в историю как текст.')
}
async function selectCopied(item: ClipboardHistoryItem, message: string) {
  clearFilters()
  selectedId.value = item.id
  announce(message)
  await nextTick()
  document.getElementById('record-' + item.id)?.focus({ preventScroll: true })
  historyList.value?.scrollTo({ top: 0 })
}
const fullscreen = ref(false)
const imageZoom = useImageZoom()
const { viewport: imageViewport, natural: imageNatural, scale: imageScale, percent: imagePercent, imageStyle, canvasStyle, dragging, canPan } = imageZoom
let unsubscribeShown: (() => void) | undefined
let unsubscribeFullscreen: (() => void) | undefined
let announcementTimer: ReturnType<typeof setTimeout> | undefined
const allTags = computed(() => historyTags(buffer.clipboardHistory))
const filtered = computed(() => filterHistory(buffer.clipboardHistory, search.value, selectedTags.value))
const historyList = ref<HTMLElement>()
const { states: fileStates, refresh: refreshFiles, update: updateFileState } = useFileAvailability(filtered, historyList)
const selected = computed(() => filtered.value.find(item => item.id === selectedId.value))
const previewItems = computed(() => buffer.clipboardHistory.filter(item => item.type === previewKind.value))
const previewIndex = computed(() => previewItems.value.findIndex(item => item.id === previewId.value))
const navigatingPreview = ref(false)
const filteringPreview = ref(false)
const navigationBlocked = computed(() => editing.value || saving.value || buffer.busy || navigatingPreview.value || filteringPreview.value)
const canPreviewPrevious = computed(() => !navigationBlocked.value && previewIndex.value > 0)
const canPreviewNext = computed(() => !navigationBlocked.value && previewIndex.value >= 0 && previewIndex.value < previewItems.value.length - 1)
watch(editor.currentId, id => { if (previewOpen.value && id) previewId.value = id })
watch(preview, item => { if (item) previewKind.value = item.type })
function recordLabel(item: ClipboardHistoryItem) {
  return item.type !== 'image' ? KIND_LABELS[item.type] + ': ' + (item.data.trim() ? shortText(item).slice(0, 160).replace(/\s+/g, ' ') : 'Пробелы и переносы строк')
    : 'Изображение, ' + item.params.size
}

watch(() => filtered.value.map(item => item.id), ids => {
  if (!selectedId.value || !ids.includes(selectedId.value)) selectedId.value = ids[0] ?? null
}, { immediate: true, flush: 'sync' })

function announce(message: string) {
  announcement.value = message
  if (announcementTimer) clearTimeout(announcementTimer)
  announcementTimer = setTimeout(() => { announcement.value = '' }, 4000)
}
function clearFilters() { search.value = ''; selectedTags.value = [] }
function select(item: ClipboardHistoryItem) { selectedId.value = item.id }
async function openPreview(item: ClipboardHistoryItem) {
  if (!await editor.flush()) return
  previewId.value = item.id
  previewKind.value = item.type
  previewFiles.value = !!item.fileUris
  if (filtered.value.some(candidate => candidate.id === item.id)) selectedId.value = item.id
  imageZoom.reset()
  editor.load(item)
  await nextTick()
  if (!previewOpen.value) previewDialog.value?.showModal()
  previewOpen.value = true
  const image = previewDialog.value?.querySelector<HTMLImageElement>('.zoom-image')
  if (image?.complete) imageZoom.loadImage(image)
}
async function movePreview(direction: number) {
  if (!previewOpen.value || (direction < 0 ? !canPreviewPrevious.value : !canPreviewNext.value)) return
  const item = previewItems.value[previewIndex.value + direction]
  if (!item) return
  navigatingPreview.value = true
  try { await openPreview(item) } finally { navigatingPreview.value = false }
}
async function setPreviewFullscreen(value: boolean) {
  if (!await buffer.setFullscreen(value)) return false
  fullscreen.value = value
  return true
}
function togglePreviewFullscreen() {
  if (previewOpen.value && !buffer.busy) void setPreviewFullscreen(!fullscreen.value)
}
async function dismissPreview() {
  if (fullscreen.value && !await setPreviewFullscreen(false)) return false
  previewDialog.value?.close()
  previewOpen.value = false
  imageZoom.reset()
  return true
}
async function closePreview() {
  if (!await editor.flush()) return
  await dismissPreview()
}
async function searchPreviewTag(tag: ClipboardTag) {
  if (!previewOpen.value || buffer.busy || saving.value || filteringPreview.value || navigatingPreview.value) return
  filteringPreview.value = true
  try {
    if (!await editor.flush() || !await dismissPreview()) return
    search.value = ''
    selectedTags.value = [{ ...tag }]
    selectedId.value = filtered.value[0]?.id ?? null
    await nextTick()
    searchPanel.value?.focus()
    document.querySelector('.history-list')?.scrollTo({ top: 0 })
  } finally { filteringPreview.value = false }
}
function handlePreviewKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
    && (event.code === 'KeyF' || event.key.toLowerCase() === 'f')) {
    event.preventDefault()
    if (!event.repeat) togglePreviewFullscreen()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if (event.repeat || buffer.busy) return
    if (fullscreen.value) void setPreviewFullscreen(false)
    else void closePreview()
  } else if (!editing.value && !isEditingTarget(event.target) && !event.ctrlKey && !event.altKey && !event.metaKey
    && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault()
    void movePreview(event.key === 'ArrowLeft' ? -1 : 1)
  }
}
async function toggleEditing() {
  await editor.toggle()
  if (editing.value) { await nextTick(); textArea.value?.focus() }
}
async function copyPreview() {
  if (previewIsText.value) {
    if (!await editor.flush()) return
    if (editor.currentId.value) await copyById(editor.currentId.value, true)
  } else await copy(preview.value, true)
}
async function prepareQuickPick() {
  colorItem.value = null
  fileAction.value = null
  if (!await editor.flush()) { previewDialog.value?.showModal(); return }
  if (!await dismissPreview()) return
  clearFilters()
  selectedId.value = filtered.value[0]?.id ?? null
  await nextTick()
  searchPanel.value?.focus()
  document.querySelector('.history-list')?.scrollTo({ top: 0 })
  refreshFiles()
}
async function copy(item: ClipboardHistoryItem | undefined, hide = false) {
  if (item) await copyById(item.id, hide)
}
async function copyById(id: string, hide = false) {
  if (buffer.busy) return
  copyingId.value = id
  const copied = await buffer.copy(id, updateFileState)
  copyingId.value = null
  if (copied) {
    announce('Скопировано в буфер обмена.')
    if (hide && await dismissPreview()) await buffer.hide()
  }
}
async function remove(item: ClipboardHistoryItem) {
  if (await buffer.remove(item.id)) announce('Запись удалена. Отмена доступна 10 секунд.')
}
async function move(direction: number) {
  selectedId.value = adjacentId(filtered.value.map(item => item.id), selectedId.value, direction)
  await nextTick()
  if (selectedId.value) {
    const element = document.getElementById('record-' + selectedId.value)
    element?.focus({ preventScroll: true })
    element?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
}
function capturePreviewKeys(event: KeyboardEvent) {
  if (colorItem.value || fileAction.value) return
  if (previewOpen.value && !event.isComposing && (event.key === 'Escape'
    || (!editing.value && !isEditingTarget(event.target) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')))) {
    event.stopImmediatePropagation()
    handlePreviewKeydown(event)
  }
}
function focusSearchOnActivation() {
  if (!previewOpen.value && !colorItem.value && !fileAction.value) searchPanel.value?.focus()
}
function captureSearchTyping(event: KeyboardEvent) {
  if (previewOpen.value || colorItem.value || fileAction.value || event.defaultPrevented || isEditingTarget(event.target)) return
  const altGraph = event.getModifierState('AltGraph')
  if ((event.ctrlKey || event.metaKey) && !event.altKey
    && (event.code === 'KeyV' || event.key.toLowerCase() === 'v')) {
    searchPanel.value?.focus()
    return
  }
  if (event.key === 'Process' || event.keyCode === 229) { searchPanel.value?.focus(); return }
  if (event.isComposing || ((!altGraph && (event.ctrlKey || event.altKey)) || event.metaKey)
    || Array.from(event.key).length !== 1) return
  event.preventDefault()
  event.stopImmediatePropagation()
  searchPanel.value?.insertText(event.key)
}
function captureSearchPaste(event: ClipboardEvent) {
  if (previewOpen.value || colorItem.value || fileAction.value || event.defaultPrevented || isEditingTarget(event.target)) return
  const text = event.clipboardData?.getData('text/plain')
  if (!text) return
  event.preventDefault()
  event.stopImmediatePropagation()
  searchPanel.value?.insertText(text)
}
function handleKeydown(event: KeyboardEvent) {
  if (colorItem.value || fileAction.value) return
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return
  const editing = isEditingTarget(event.target)
  const otherAction = isActionTarget(event.target)
  if (event.key === 'Escape') {
    event.preventDefault()
    if (event.repeat) return
    if (search.value || selectedTags.value.length) { clearFilters(); searchPanel.value?.focus() }
    else void buffer.hide()
    return
  }
  if (otherAction || (editing && !(event.target instanceof HTMLInputElement))) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    void move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void copy(selected.value, true)
  } else if (event.key === 'Delete' && !editing && selected.value) {
    event.preventDefault()
    void remove(selected.value)
  }
}
function shortText(item: ClipboardHistoryItem) {
  return (item.fileUris ? item.data.split('\n').map(file => file.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || file).join('\n') : item.data).slice(0, 1200)
}

onMounted(() => {
  document.addEventListener('keydown', capturePreviewKeys, true)
  document.addEventListener('keydown', captureSearchTyping, true)
  document.addEventListener('paste', captureSearchPaste, true)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('focus', focusSearchOnActivation)
  unsubscribeShown = window.electronAPI?.onWindowShown(prepareQuickPick)
  unsubscribeFullscreen = window.electronAPI?.onPreviewFullscreenChanged(value => { fullscreen.value = value })
  searchPanel.value?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', capturePreviewKeys, true)
  document.removeEventListener('keydown', captureSearchTyping, true)
  document.removeEventListener('paste', captureSearchPaste, true)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('focus', focusSearchOnActivation)
  unsubscribeShown?.()
  unsubscribeFullscreen?.()
  if (announcementTimer) clearTimeout(announcementTimer)
})
</script>

<template>
  <main class="history-page flex h-full min-h-0 w-full flex-col gap-2.5 px-3.5 pt-2 pb-2.5">
    <header class="flex shrink-0 items-center gap-2 select-none" :class="{ 'window-drag': !previewOpen && !colorItem && !fileAction }">
      <div class="mr-auto flex items-center gap-2"><AppIcon :path="mdiClipboardTextOutline" class="size-6 text-accent" /><h1 class="text-[17px] font-semibold tracking-tight">ClipClip</h1></div>
      <span class="flex items-center gap-1.5 text-xs text-muted" :title="buffer.persistent ? 'История сохраняется с шифрованием' : 'История только в памяти этой сессии'">
        <span class="size-1.5 rounded-full" :class="buffer.paused ? 'bg-amber-500' : 'bg-emerald-600 dark:bg-emerald-400'" />{{ buffer.paused ? 'Пауза' : 'Запись' }}
      </span>
      <button type="button" class="icon-button" :disabled="buffer.busy || buffer.loading"
        :title="buffer.paused ? 'Продолжить запись' : 'Приостановить запись'" :aria-label="buffer.paused ? 'Продолжить запись' : 'Приостановить запись'"
        @click="buffer.setPaused(!buffer.paused)"><AppIcon :path="buffer.paused ? mdiPlay : mdiPause" /></button>
      <button type="button" class="hide-window icon-button" aria-label="Скрыть окно" title="Скрыть окно (Esc)" @click="buffer.hide"><AppIcon :path="mdiClose" /></button>
    </header>

    <p v-if="!buffer.loading && !buffer.persistent" class="shrink-0 text-xs text-muted">История только в памяти этой сессии</p>
    <p v-if="buffer.error" role="alert" class="shrink-0 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{{ buffer.error }}</p>
    <p v-if="!buffer.loading && !buffer.shortcutAvailable" class="shrink-0 text-xs leading-snug text-accent">
      Ctrl + Alt + B недоступна. Откройте окно через значок ClipClip.
    </p>
    <SearchPanel ref="searchPanel" v-model="search" v-model:selected-tags="selectedTags" :all-tags="allTags" />

    <section class="history-section flex min-h-0 flex-1 flex-col" aria-labelledby="history-title" :aria-busy="buffer.loading">
      <div class="flex shrink-0 items-center justify-between pb-2">
        <h2 id="history-title" class="text-xs font-medium text-muted">{{ search || selectedTags.length ? 'Результаты поиска' : 'Последние записи' }}</h2>
        <span class="text-xs text-muted tabular-nums">{{ filtered.length }} / {{ HISTORY_LIMIT }}</span>
      </div>
      <div v-if="buffer.loading" role="status" class="rounded-lg bg-accent/8 px-3 py-4 text-center text-xs text-muted">Загрузка истории…</div>
      <div v-else-if="!filtered.length" class="empty-state my-auto px-3 py-6 text-center text-muted">
        <AppIcon :path="mdiClipboardTextOutline" class="mx-auto size-10" />
        <h3 class="mt-2.5 mb-1.5 text-base font-semibold text-ink">{{ search || selectedTags.length ? 'Совпадений нет' : 'История пока пуста' }}</h3>
        <p class="mb-2.5 text-[13px] text-pretty">{{ search || selectedTags.length ? 'Попробуйте другой запрос или уберите фильтры.' : buffer.paused ? 'Продолжите запись и скопируйте текст, изображение или файл.' : 'Скопируйте текст, изображение, файл или папку — запись появится здесь.' }}</p>
        <button v-if="search || selectedTags.length" type="button" class="text-button" @click="clearFilters">Сбросить поиск и фильтры</button>
      </div>

      <ul v-else ref="historyList" class="history-list -mx-0.5 flex min-h-0 flex-col gap-2 overflow-y-auto p-0.5" @scroll.passive="refreshFiles">
        <li v-for="item in filtered" :key="item.id" :data-file-id="item.fileUris ? item.id : undefined">
          <article class="clipboard-record flex items-center overflow-hidden rounded-lg hover:bg-accent/4 focus-within:bg-accent/10"
            :class="item.id === selectedId ? 'selected bg-selected' : 'bg-surface'">
            <FileLocations v-if="item.fileUris" :item="item" @open="openFileActions(item, $event)" />
            <button v-if="colors[item.id]" type="button" class="color-swatch icon-button ml-1" :disabled="buffer.busy"
              :aria-label="'Конвертировать цвет ' + item.data.trim()" title="Конвертировать цвет — нажмите, чтобы выбрать формат для копирования"
              aria-haspopup="dialog" @click="openColor(item)">
              <span class="color-checker block size-5 overflow-hidden rounded" aria-hidden="true"><span class="block size-full" :style="{ backgroundColor: colors[item.id] ?? undefined }" /></span>
            </button>
            <button :id="'record-' + item.id" type="button" class="record-select block min-h-[78px] min-w-0 flex-1 rounded-md px-3 py-2.5 text-left focus-visible:outline-none disabled:cursor-wait"
              :aria-pressed="item.id === selectedId" :aria-label="'Скопировать и скрыть. ' + recordLabel(item) + ', ' + item.params.source.name" title="Скопировать и скрыть"
              :disabled="buffer.busy" :tabindex="item.id === selectedId ? 0 : -1" @focus="select(item)" @click="select(item); copy(item, true)">
              <p v-if="item.type !== 'image'" class="text-preview line-clamp-2 text-[13px] leading-snug whitespace-pre-wrap wrap-anywhere">
                <span v-if="!item.data.trim()" class="text-muted">Пробелы и переносы строк</span>
                <template v-else v-for="(part, index) in highlightParts(shortText(item), search)" :key="index">
                  <mark v-if="part.matched" class="query-mark rounded-xs bg-accent/18 px-px text-inherit">{{ part.text }}</mark><span v-else>{{ part.text }}</span>
                </template>
              </p>
              <img v-else :src="item.data" :alt="'Изображение из буфера, ' + item.params.size" class="image-preview block h-12 max-w-full rounded object-contain" loading="lazy" />
              <span class="mt-1.5 flex items-center gap-2 text-[11px] leading-snug text-muted">
                <span class="flex min-w-0 flex-1 items-center gap-1">
                  <span class="truncate">{{ item.params.source.name }}</span>
                  <span v-if="item.fileUris && ['missing', 'unavailable'].includes(fileStates[item.id]?.status ?? '')"
                    class="file-unavailable inline-flex shrink-0 text-danger" role="img"
                    :aria-label="fileStates[item.id]?.message" :title="fileStates[item.id]?.message">
                    <AppIcon :path="mdiAlertCircleOutline" class="size-3.5" />
                  </span>
                </span>
                <span class="max-w-[40%] shrink-0 truncate">{{ item.params.size }}</span>
              </span>
            </button>
            <div class="flex flex-col p-0.5">
              <button type="button" class="preview-button icon-button" :aria-label="'Просмотреть запись. ' + recordLabel(item)" title="Полный просмотр" @click="openPreview(item)"><AppIcon :path="mdiEyeOutline" class="size-[18px]" /></button>
              <button type="button" class="icon-button hover:text-danger" :disabled="buffer.busy" :aria-label="'Удалить запись. ' + recordLabel(item)" title="Удалить" @click="remove(item)"><AppIcon :path="mdiDeleteOutline" class="size-[18px]" /></button>
            </div>
          </article>
        </li>
      </ul>
    </section>

    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
    <div v-if="announcement || buffer.canUndo" class="flex shrink-0 items-center justify-between gap-2 text-xs text-muted">
      <p aria-hidden="true">{{ announcement }}</p>
      <button v-if="buffer.canUndo" type="button" class="text-button" :disabled="buffer.busy" @click="buffer.undo"><AppIcon :path="mdiUndo" class="size-4" />Отменить удаление</button>
    </div>
    <footer class="flex shrink-0 justify-between gap-1.5 border-t border-line pt-2 text-[11px] text-muted" aria-label="Горячие клавиши">
      <span><kbd>↑</kbd><kbd>↓</kbd> выбор</span><span><kbd>Enter</kbd> копировать</span><span><kbd>Esc</kbd> скрыть</span>
    </footer>

    <dialog ref="previewDialog" class="preview-dialog" :class="{ 'is-fullscreen': fullscreen }" aria-labelledby="preview-title" @keydown.stop="handlePreviewKeydown" @cancel.prevent="closePreview">
      <div class="flex shrink-0 items-center justify-between gap-2 select-none" :class="{ 'window-drag': !fullscreen }">
        <h2 id="preview-title" class="flex min-w-0 items-baseline gap-1.5 text-[15px] font-semibold"><span class="truncate">{{ KIND_LABELS[previewKind] }}</span><span class="preview-position shrink-0 text-xs text-muted tabular-nums" role="status">({{ previewIndex >= 0 ? previewIndex + 1 : '—' }}/{{ previewItems.length }})</span></h2>
        <div class="flex">
          <button type="button" class="fullscreen-toggle icon-button" :aria-pressed="fullscreen" :disabled="buffer.busy"
            :aria-label="fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'" :title="(fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран') + ' (Ctrl + F)'" @click="togglePreviewFullscreen"><AppIcon :path="fullscreen ? mdiFullscreenExit : mdiFullscreen" /></button>
          <button v-if="previewIsText" type="button" class="edit-toggle icon-button" :aria-pressed="editing"
            :aria-label="editing ? 'Завершить редактирование' : 'Редактировать текст'" :title="editing ? 'Завершить редактирование' : 'Редактировать текст'" @click="toggleEditing"><AppIcon :path="editing ? mdiCheck : mdiPencilOutline" /></button>
          <button v-if="editing" type="button" class="reset-edit icon-button" :disabled="draft === originalText && draft === savedText"
            aria-label="Сбросить к исходному тексту" title="Сбросить к исходному тексту" @click="editor.reset"><AppIcon :path="mdiRestore" /></button>
          <button type="button" class="close-preview icon-button" aria-label="Закрыть просмотр" @click="closePreview"><AppIcon :path="mdiClose" /></button>
        </div>
      </div>
      <div class="preview-toolbar flex h-10 shrink-0 items-center justify-between gap-1" aria-label="Навигация и масштаб">
        <button type="button" class="preview-previous icon-button" :disabled="!canPreviewPrevious" aria-label="Предыдущая запись этого типа" title="Предыдущая запись этого типа (←)" @click="movePreview(-1)"><AppIcon :path="mdiChevronLeft" /></button>
        <div v-if="previewKind === 'image' && preview" class="flex items-center gap-1" aria-label="Масштаб изображения">
          <div class="zoom-controls flex h-10 w-[140px] items-center rounded-full bg-ink/8 px-0.5 shadow-sm dark:bg-neutral-800">
            <button type="button" class="zoom-out zoom-step" aria-label="Уменьшить изображение" title="Уменьшить" :disabled="!imageNatural.width || imageScale <= .01" @click="imageZoom.zoom(-1)"><span><AppIcon :path="mdiMinus" class="size-4" /></span></button>
            <button type="button" class="zoom-percent h-10 min-w-0 flex-1 rounded-full text-xs font-semibold text-ink tabular-nums hover:bg-ink/5 dark:text-neutral-100 dark:hover:bg-white/5" aria-label="Масштаб 100 процентов" title="Исходный размер — 100%" :disabled="!imageNatural.width" @click="imageZoom.setScale(1)">{{ imagePercent }} %</button>
            <button type="button" class="zoom-in zoom-step" aria-label="Увеличить изображение" title="Увеличить" :disabled="!imageNatural.width || imageScale >= 8" @click="imageZoom.zoom(1)"><span><AppIcon :path="mdiPlus" class="size-4" /></span></button>
          </div>
          <button type="button" class="zoom-fit icon-button rounded-full" :disabled="!imageNatural.width" aria-label="Вписать изображение" title="Вписать изображение в область просмотра" @click="imageZoom.fitImage"><AppIcon :path="mdiFitToScreenOutline" class="size-5" /></button>
        </div>
        <button type="button" class="preview-next icon-button" :disabled="!canPreviewNext" aria-label="Следующая запись этого типа" title="Следующая запись этого типа (→)" @click="movePreview(1)"><AppIcon :path="mdiChevronRight" /></button>
      </div>
      <div v-if="preview" class="preview-metadata flex shrink-0 flex-wrap gap-1.5" aria-label="Метки и источник записи">
        <button v-for="tag in preview.params.tags" :key="JSON.stringify([tag.code, tag.value])" type="button"
          class="preview-tag group inline-flex min-h-10 min-w-10 max-w-full items-center rounded-lg"
          :disabled="buffer.busy || saving || filteringPreview || navigatingPreview"
          :aria-label="'Найти по метке. ' + TAG_LABELS[tag.code] + ': ' + tag.value"
          :title="'Найти по метке. ' + TAG_LABELS[tag.code] + ': ' + tag.value" @click="searchPreviewTag(tag)">
          <TagBadge :tag="tag" />
        </button>
      </div>
      <p v-if="preview?.params.source.title" class="shrink-0 truncate text-[11px] text-muted" :title="preview.params.source.title">{{ preview.params.source.title }}</p>
      <div v-if="previewKind !== 'image'" class="preview-content min-h-0 overflow-auto text-[13px]">
        <textarea v-if="editing" ref="textArea" v-model="draft" class="text-editor block h-full min-h-0 w-full resize-none rounded-md border border-line bg-canvas p-2.5 font-sans leading-relaxed focus:outline-2 focus:-outline-offset-1 focus:outline-accent" aria-label="Редактирование полного текста" spellcheck="false" />
        <pre v-else class="font-sans whitespace-pre-wrap wrap-anywhere">{{ draft }}</pre>
      </div>
      <div v-else-if="preview" ref="imageViewport" class="preview-content image-viewport min-h-0 touch-none overflow-scroll overscroll-contain rounded-lg bg-canvas select-none"
        :class="dragging ? 'cursor-grabbing' : canPan ? 'cursor-grab' : 'cursor-default'"
        @wheel="imageZoom.wheel" @pointerdown="imageZoom.startPan" @pointermove="imageZoom.pan" @pointerup="imageZoom.endPan" @pointercancel="imageZoom.endPan" @lostpointercapture="imageZoom.endPan">
        <div class="grid min-h-full min-w-full w-max place-items-center">
          <div class="zoom-canvas relative shrink-0 overflow-hidden" :style="canvasStyle">
            <img :src="preview.data" :alt="'Полное изображение, ' + preview.params.size" :style="imageStyle" class="zoom-image absolute top-0 left-0 block origin-top-left" draggable="false" @load="imageZoom.loaded" />
          </div>
        </div>
      </div>
      <p v-else>Запись уже удалена.</p>
      <p v-if="saveError" class="text-xs text-danger" role="alert">{{ saveError }}</p>
      <p v-else-if="buffer.error" class="text-xs text-danger" role="alert">{{ buffer.error }}</p>
      <p v-else-if="editing" class="text-[11px] text-muted" role="status">{{ saving ? 'Сохраняется…' : draft !== savedText ? 'Есть изменения…' : 'Версии сохраняются в истории' }}</p>
      <button v-if="previewKind !== 'image' || preview" type="button" class="primary-button" :aria-busy="saving || copyingId !== null" :disabled="buffer.busy || saving" @click="copyPreview">
        <AppIcon :path="mdiContentCopy" />{{ saving ? 'Сохраняется…' : copyingId !== null ? 'Копируется…' : 'Копировать и скрыть' }}
      </button>
    </dialog>
    <ColorConverter v-if="colorItem" :id="colorItem.id" :text="colorItem.data" @close="colorItem = null" @copied="colorCopied" />
    <FileActions v-if="fileAction" :item="fileAction.item" :index="fileAction.index" @close="fileAction = null" @copied="pathCopied" />
  </main>
</template>
