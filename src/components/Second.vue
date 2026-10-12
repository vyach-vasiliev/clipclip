<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { mdiContentCopy, mdiDeleteOutline, mdiPause, mdiPlay, mdiUndo, mdiClipboardTextOutline } from '@mdi/js'
import { HISTORY_LIMIT, TAG_LABELS, tagKey, type ClipboardHistoryItem, type ClipboardTag } from '../../shared/clipboard'
import { useBufferStore } from '../store/buffer'
import { adjacentId, filterHistory, highlightParts, historyTags, isEditingTarget, isActionTarget } from '../utils/history'
import SearchPanel from './SearchPanel.vue'

const buffer = useBufferStore()
const search = ref('')
const selectedTags = ref<ClipboardTag[]>([])
const selectedId = ref<string | null>(null)
const searchPanel = ref<InstanceType<typeof SearchPanel>>()
const announcement = ref('')
const copyingId = ref<string | null>(null)
let unsubscribeShown: (() => void) | undefined
let announcementTimer: ReturnType<typeof setTimeout> | undefined
const allTags = computed(() => historyTags(buffer.clipboardHistory))
const filtered = computed(() => filterHistory(buffer.clipboardHistory, search.value, selectedTags.value))
const selected = computed(() => filtered.value.find(item => item.id === selectedId.value))
const tagLabels = TAG_LABELS
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
async function copy(item: ClipboardHistoryItem | undefined, hide = false) {
  if (!item || buffer.busy) return
  copyingId.value = item.id
  const copied = await buffer.copy(item.id)
  copyingId.value = null
  if (copied) {
    announce('Скопировано в буфер обмена.')
    if (hide) await buffer.hide()
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
  unsubscribeShown = window.electronAPI?.onWindowShown(() => searchPanel.value?.focus())
  searchPanel.value?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  unsubscribeShown?.()
  if (announcementTimer) clearTimeout(announcementTimer)
})
</script>

<template>
  <main class="history-page">
    <header class="page-header">
      <div>
        <div class="brand-line"><v-icon :icon="mdiClipboardTextOutline" aria-hidden="true" /><span>ClipClip</span></div>
        <h1>История буфера обмена</h1>
        <p class="intro">Скопированные тексты и изображения всегда под рукой.</p>
      </div>
      <v-btn variant="outlined" :prepend-icon="buffer.paused ? mdiPlay : mdiPause" :disabled="buffer.busy || buffer.loading"
        @click="buffer.setPaused(!buffer.paused)">{{ buffer.paused ? 'Продолжить запись' : 'Пауза' }}</v-btn>
    </header>

    <div class="status-row">
      <span class="capture-status"><span :class="['status-dot', { paused: buffer.paused }]" />{{ buffer.paused ? 'Запись приостановлена' : 'Запись включена' }}</span>
      <span>{{ buffer.persistent ? 'История сохраняется с шифрованием' : 'История только в памяти этой сессии' }}</span>
    </div>
    <v-alert v-if="buffer.error" type="error" variant="tonal" role="alert" class="notice">{{ buffer.error }}</v-alert>
    <v-alert v-if="!buffer.loading && !buffer.shortcutAvailable" type="info" variant="tonal" class="notice">
      Ctrl + Alt + B недоступна. Открывайте ClipClip через область уведомлений или панель задач.
    </v-alert>
    <SearchPanel ref="searchPanel" v-model="search" v-model:selected-tags="selectedTags" :all-tags="allTags" />

    <section class="history-section" aria-labelledby="history-title" :aria-busy="buffer.loading">
      <div class="section-heading">
        <h2 id="history-title">{{ search || selectedTags.length ? 'Результаты поиска' : 'Последние записи' }}</h2>
        <span class="record-count">{{ filtered.length }} / {{ HISTORY_LIMIT }}</span>
      </div>
      <v-progress-linear v-if="buffer.loading" indeterminate aria-label="Загрузка истории" />
      <div v-else-if="!filtered.length" class="empty-state">
        <v-icon :icon="mdiClipboardTextOutline" size="40" aria-hidden="true" />
        <h3>{{ search || selectedTags.length ? 'Совпадений нет' : 'История пока пуста' }}</h3>
        <p>{{ search || selectedTags.length ? 'Попробуйте другой запрос или уберите фильтры.' : buffer.paused ? 'Продолжите запись и скопируйте текст или изображение.' : 'Скопируйте текст или изображение в любом приложении — запись появится здесь.' }}</p>
        <v-btn v-if="search || selectedTags.length" variant="text" @click="clearFilters">Сбросить поиск и фильтры</v-btn>
      </div>

      <ul v-else class="history-list">
        <li v-for="item in filtered" :key="item.id">
          <article class="clipboard-record" :class="{ selected: item.id === selectedId }">
            <div class="record-topline">
              <span class="muted">{{ item.type === 'text' ? 'Текст' : 'Изображение' }}</span>
              <div class="record-actions">
                <v-btn variant="tonal" :prepend-icon="mdiContentCopy" :loading="copyingId === item.id" :disabled="buffer.busy"
                  :aria-label="'Скопировать запись. ' + recordLabel(item)" @click="copy(item)">Копировать</v-btn>
                <v-btn variant="text" :icon="mdiDeleteOutline" :disabled="buffer.busy" :aria-label="'Удалить запись. ' + recordLabel(item)" @click="remove(item)" />
              </div>
            </div>
            <button :id="'record-' + item.id" class="record-select" :aria-pressed="item.id === selectedId"
              :aria-label="recordLabel(item) + ', ' + item.params.source.name"
              :tabindex="item.id === selectedId ? 0 : -1" @focus="select(item)" @click="select(item)">
              <p v-if="item.type === 'text'" class="text-preview">
                <span v-if="!item.data.trim()" class="muted">Пробелы и переносы строк</span>
                <template v-else v-for="(part, index) in highlightParts(shortText(item), search)" :key="index">
                  <mark v-if="part.matched" class="query-mark">{{ part.text }}</mark><span v-else>{{ part.text }}</span>
                </template>
              </p>
              <img v-else :src="item.data" :alt="'Изображение из буфера, ' + item.params.size" class="image-preview" loading="lazy" />
            </button>
            <details v-if="item.type === 'text' && (item.data.length > 240 || item.data.split('\n').length > 4)" class="full-preview">
              <summary>Полный текст</summary><pre>{{ item.data }}</pre>
            </details>
            <details v-if="item.type === 'image'" class="full-preview">
              <summary>Изображение целиком</summary><img :src="item.data" :alt="'Полное изображение, ' + item.params.size" />
            </details>
            <footer class="record-footer">
              <div class="record-tags" aria-label="Свойства и фильтры">
                <v-chip v-for="tag in item.params.tags" :key="tagKey(tag)" variant="outlined"
                  :title="tagLabels[tag.code] + ': ' + tag.value + (tag.code === 'source' ? ' (приблизительно)' : '')"
                  @click="searchPanel?.addSelectedTag(tag)">{{ tag.value }}</v-chip>
              </div>
            </footer>
          </article>
        </li>
      </ul>
    </section>

    <div class="feedback-row">
      <p role="status" aria-live="polite">{{ announcement }}</p>
      <v-btn v-if="buffer.canUndo" variant="text" :prepend-icon="mdiUndo" :disabled="buffer.busy" @click="buffer.undo">Отменить удаление</v-btn>
    </div>
    <footer class="keyboard-help" aria-label="Горячие клавиши">
      <span><kbd>↑</kbd><kbd>↓</kbd> выбор</span><span><kbd>Enter</kbd> копировать и скрыть</span>
      <span><kbd>Esc</kbd> сбросить поиск / скрыть</span><span><kbd>Delete</kbd> удалить в списке</span>
      <span class="show-shortcut"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>B</kbd> открыть</span>
    </footer>
  </main>
</template>
