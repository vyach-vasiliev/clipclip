<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { mdiContentCopy, mdiDeleteOutline, mdiPause, mdiPlay, mdiUndo, mdiClipboardTextOutline, mdiEyeOutline, mdiClose, mdiPencilOutline, mdiRestore, mdiCheck } from '@mdi/js'
import { HISTORY_LIMIT, type ClipboardHistoryItem, type ClipboardTag } from '../../shared/clipboard'
import { useBufferStore } from '../store/buffer'
import { adjacentId, filterHistory, highlightParts, historyTags, isEditingTarget, isActionTarget } from '../utils/history'
import SearchPanel from './SearchPanel.vue'
import AppIcon from './AppIcon.vue'
import { useTextEditor } from '../composables/textEditor'

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
const previewKind = ref<'text' | 'image'>('text')
let unsubscribeShown: (() => void) | undefined
let announcementTimer: ReturnType<typeof setTimeout> | undefined
const allTags = computed(() => historyTags(buffer.clipboardHistory))
const filtered = computed(() => filterHistory(buffer.clipboardHistory, search.value, selectedTags.value))
const selected = computed(() => filtered.value.find(item => item.id === selectedId.value))
function recordLabel(item: ClipboardHistoryItem) {
  return item.type === 'text' ? 'Текст: ' + (item.data.trim() ? item.data.slice(0, 160).replace(/\s+/g, ' ') : 'Пробелы и переносы строк')
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
  editor.load(item)
  await nextTick()
  previewDialog.value?.showModal()
}
async function closePreview() {
  if (!await editor.flush()) return
  previewDialog.value?.close()
}
async function toggleEditing() {
  await editor.toggle()
  if (editing.value) { await nextTick(); textArea.value?.focus() }
}
async function copyPreview() {
  if (previewKind.value === 'text') {
    if (!await editor.flush()) return
    if (editor.currentId.value) await copyById(editor.currentId.value, true)
  } else await copy(preview.value, true)
}
async function prepareQuickPick() {
  if (!await editor.flush()) { previewDialog.value?.showModal(); return }
  previewDialog.value?.close()
  clearFilters()
  selectedId.value = filtered.value[0]?.id ?? null
  searchPanel.value?.focus()
  document.querySelector('.history-list')?.scrollTo({ top: 0 })
}
async function copy(item: ClipboardHistoryItem | undefined, hide = false) {
  if (item) await copyById(item.id, hide)
}
async function copyById(id: string, hide = false) {
  if (buffer.busy) return
  copyingId.value = id
  const copied = await buffer.copy(id)
  copyingId.value = null
  if (copied) {
    announce('Скопировано в буфер обмена.')
    if (hide) { previewDialog.value?.close(); await buffer.hide() }
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
function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return
  const editing = isEditingTarget(event.target)
  const otherAction = isActionTarget(event.target)
  if (event.key === 'Escape') {
    event.preventDefault()
    if (search.value || selectedTags.value.length) clearFilters()
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
  } else if (!editing && Array.from(event.key).length === 1) {
    searchPanel.value?.focus()
  }
}
function shortText(item: ClipboardHistoryItem) { return item.data.slice(0, 1200) }

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  unsubscribeShown = window.electronAPI?.onWindowShown(prepareQuickPick)
  searchPanel.value?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  unsubscribeShown?.()
  if (announcementTimer) clearTimeout(announcementTimer)
})
</script>

<template>
  <main class="history-page flex h-full min-h-0 w-full flex-col gap-2.5 px-3.5 pt-2 pb-2.5">
    <header class="flex shrink-0 items-center gap-2">
      <div class="mr-auto flex items-center gap-2"><AppIcon :path="mdiClipboardTextOutline" class="size-6 text-accent" /><h1 class="text-[17px] font-semibold tracking-tight">ClipClip</h1></div>
      <span class="flex items-center gap-1.5 text-xs text-muted" :title="buffer.persistent ? 'История сохраняется с шифрованием' : 'История только в памяти этой сессии'">
        <span class="size-1.5 rounded-full" :class="buffer.paused ? 'bg-amber-500' : 'bg-emerald-600 dark:bg-emerald-400'" />{{ buffer.paused ? 'Пауза' : 'Запись' }}
      </span>
      <button type="button" class="icon-button" :disabled="buffer.busy || buffer.loading"
        :title="buffer.paused ? 'Продолжить запись' : 'Приостановить запись'" :aria-label="buffer.paused ? 'Продолжить запись' : 'Приостановить запись'"
        @click="buffer.setPaused(!buffer.paused)"><AppIcon :path="buffer.paused ? mdiPlay : mdiPause" /></button>
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
        <p class="mb-2.5 text-[13px] text-pretty">{{ search || selectedTags.length ? 'Попробуйте другой запрос или уберите фильтры.' : buffer.paused ? 'Продолжите запись и скопируйте текст или изображение.' : 'Скопируйте текст или изображение в любом приложении — запись появится здесь.' }}</p>
        <button v-if="search || selectedTags.length" type="button" class="text-button" @click="clearFilters">Сбросить поиск и фильтры</button>
      </div>

      <ul v-else class="history-list -mx-0.5 flex min-h-0 flex-col gap-2 overflow-y-auto p-0.5">
        <li v-for="item in filtered" :key="item.id">
          <article class="clipboard-record flex items-center overflow-hidden rounded-lg ring-1"
            :class="item.id === selectedId ? 'selected bg-selected ring-2 ring-accent' : 'bg-surface ring-line'">
            <button :id="'record-' + item.id" type="button" class="record-select block min-h-[78px] min-w-0 flex-1 rounded-md px-3 py-2.5 text-left hover:bg-accent/4 disabled:cursor-wait"
              :aria-pressed="item.id === selectedId" :aria-label="'Скопировать и скрыть. ' + recordLabel(item) + ', ' + item.params.source.name" title="Скопировать и скрыть"
              :disabled="buffer.busy" :tabindex="item.id === selectedId ? 0 : -1" @focus="select(item)" @click="select(item); copy(item, true)">
              <p v-if="item.type === 'text'" class="text-preview line-clamp-2 text-[13px] leading-snug whitespace-pre-wrap wrap-anywhere">
                <span v-if="!item.data.trim()" class="text-muted">Пробелы и переносы строк</span>
                <template v-else v-for="(part, index) in highlightParts(shortText(item), search)" :key="index">
                  <mark v-if="part.matched" class="query-mark rounded-xs bg-accent/18 px-px text-inherit">{{ part.text }}</mark><span v-else>{{ part.text }}</span>
                </template>
              </p>
              <img v-else :src="item.data" :alt="'Изображение из буфера, ' + item.params.size" class="image-preview block h-12 max-w-full rounded object-contain" loading="lazy" />
              <span class="mt-1.5 flex gap-2 text-[11px] leading-snug text-muted"><span class="min-w-0 flex-1 truncate">{{ item.params.source.name }}</span><span class="max-w-[40%] shrink-0 truncate">{{ item.params.size }}</span></span>
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

    <dialog ref="previewDialog" class="preview-dialog" aria-labelledby="preview-title" @keydown.stop @cancel.prevent="closePreview">
      <div class="flex shrink-0 items-center justify-between gap-2"><h2 id="preview-title" class="text-[15px] font-semibold">{{ previewKind === 'image' ? 'Изображение' : 'Полный текст' }}</h2>
        <div class="flex">
          <button v-if="previewKind === 'text'" type="button" class="edit-toggle icon-button" :aria-pressed="editing"
            :aria-label="editing ? 'Завершить редактирование' : 'Редактировать текст'" :title="editing ? 'Завершить редактирование' : 'Редактировать текст'" @click="toggleEditing"><AppIcon :path="editing ? mdiCheck : mdiPencilOutline" /></button>
          <button v-if="editing" type="button" class="reset-edit icon-button" :disabled="draft === originalText && draft === savedText"
            aria-label="Сбросить к исходному тексту" title="Сбросить к исходному тексту" @click="editor.reset"><AppIcon :path="mdiRestore" /></button>
          <button type="button" class="close-preview icon-button" aria-label="Закрыть просмотр" @click="closePreview"><AppIcon :path="mdiClose" /></button>
        </div>
      </div>
      <div class="preview-content min-h-0 overflow-auto text-[13px]">
        <textarea v-if="editing" ref="textArea" v-model="draft" class="text-editor block max-h-[45dvh] min-h-[180px] w-full resize-y rounded-md border border-line bg-canvas p-2.5 font-sans leading-relaxed focus:outline-2 focus:-outline-offset-1 focus:outline-accent" aria-label="Редактирование полного текста" spellcheck="false" />
        <pre v-else-if="previewKind === 'text'" class="font-sans whitespace-pre-wrap wrap-anywhere">{{ draft }}</pre>
        <img v-else-if="preview" :src="preview.data" :alt="'Полное изображение, ' + preview.params.size" class="block max-w-full" />
        <p v-else>Запись уже удалена.</p>
      </div>
      <p v-if="saveError" class="text-xs text-danger" role="alert">{{ saveError }}</p>
      <p v-else-if="buffer.error" class="text-xs text-danger" role="alert">{{ buffer.error }}</p>
      <p v-else-if="editing" class="text-[11px] text-muted" role="status">{{ saving ? 'Сохраняется…' : draft !== savedText ? 'Есть изменения…' : 'Версии сохраняются в истории' }}</p>
      <button v-if="previewKind === 'text' || preview" type="button" class="primary-button" :aria-busy="saving || copyingId !== null" :disabled="buffer.busy || saving" @click="copyPreview">
        <AppIcon :path="mdiContentCopy" />{{ saving ? 'Сохраняется…' : copyingId !== null ? 'Копируется…' : 'Копировать и скрыть' }}
      </button>
    </dialog>
  </main>
</template>
