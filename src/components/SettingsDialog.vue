<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mdiClose, mdiClipboardTextOutline, mdiDeleteOutline, mdiExport, mdiImport } from '@mdi/js'
import about from 'virtual:clipclip-licenses'
import { HISTORY_LIMIT, MAX_HISTORY_LIMIT, isHistoryLimit } from '../../shared/clipboard'
import { useBufferStore } from '../store/buffer'
import AppIcon from './AppIcon.vue'
import ShortcutSettings from './ShortcutSettings.vue'
import { shortcutLabel } from '../../shared/shortcuts'
import { BACKUP_MANIFEST_VERSION } from '../../shared/backup'

const emit = defineEmits<{ close: [] }>()
const buffer = useBufferStore()
const dialog = ref<HTMLDialogElement>()
const tabs = { general: 'Основные', shortcuts: 'Горячие клавиши', about: 'О программе' }
const tab = ref<keyof typeof tabs>('general')
const clearDialog = ref<HTMLDialogElement>()
const actionNotice = ref('')
const importSettings = ref(false)
async function transferHistory(mode: 'import' | 'export') {
  await save()
  actionNotice.value = ''
  const result = await buffer.transferHistory(mode, importSettings.value)
  if (result?.status === 'success') actionNotice.value = result.message
}
const ordinaryCount = computed(() => buffer.clipboardHistory.filter(item => !item.pinned).length)
const favoriteCount = computed(() => buffer.clipboardHistory.filter(item => item.pinned).length)
async function confirmClear() {
  await save()
  await nextTick()
  clearDialog.value?.showModal()
}
async function clearHistory() {
  if (await buffer.clearHistory()) {
    clearDialog.value?.close()
    actionNotice.value = 'История очищена.'
  }
}
const limit = ref<number | string>(buffer.historyLimit)
const saveStatus = ref<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
const valid = computed(() => isHistoryLimit(limit.value))
const changed = computed(() => limit.value !== buffer.historyLimit)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let inFlight: Promise<boolean> | undefined
let disposed = false
function cancelTimer() { clearTimeout(saveTimer); saveTimer = undefined }
function scheduleSave() {
  actionNotice.value = ''
  cancelTimer()
  saveStatus.value = valid.value && changed.value ? 'pending' : 'idle'
  if (saveStatus.value === 'pending' && !disposed) saveTimer = setTimeout(() => { void save() }, 600)
}
watch(limit, scheduleSave)
watch(() => buffer.historyLimit, (value, previous) => {
  if (limit.value === previous) limit.value = value
})
watch([() => buffer.busy, () => buffer.loading], ([busy, loading]) => {
  if (!busy && !loading && !inFlight && !saveTimer && saveStatus.value === 'pending') void save()
})

async function save() {
  cancelTimer()
  if (inFlight) { await inFlight; return save() }
  if (!valid.value || !changed.value) return
  if (buffer.busy || buffer.loading) { saveStatus.value = 'pending'; return }
  const value = limit.value as number
  saveStatus.value = 'saving'
  inFlight = buffer.setHistoryLimit(value)
  const applied = await inFlight
  inFlight = undefined
  if (limit.value !== value) scheduleSave()
  else saveStatus.value = applied ? 'saved' : 'error'
}
async function close() { await save(); dialog.value?.close(); emit('close') }
function moveTab(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const keys = Object.keys(tabs) as (keyof typeof tabs)[]
  tab.value = event.key === 'Home' ? 'general' : event.key === 'End' ? 'about'
    : keys[(keys.indexOf(tab.value) + (event.key === 'ArrowLeft' ? keys.length - 1 : 1)) % keys.length]
  dialog.value?.querySelector<HTMLButtonElement>(`#settings-${tab.value}-tab`)?.focus()
}
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => { disposed = true; cancelTimer(); void save(); clearDialog.value?.close(); dialog.value?.close() })
</script>

<template>
  <dialog ref="dialog" class="settings-dialog preview-dialog" aria-labelledby="settings-title"
    @keydown.stop @paste.stop @cancel.prevent="close">
    <header class="flex shrink-0 items-center justify-between gap-2">
      <h2 id="settings-title" class="text-[15px] font-semibold">Настройки</h2>
      <button type="button" class="icon-button" aria-label="Закрыть настройки" autofocus @click="close"><AppIcon :path="mdiClose" /></button>
    </header>
    <div class="settings-notice shrink-0 rounded-lg bg-accent/8 px-3 py-2 text-xs leading-relaxed text-accent" role="status" aria-live="polite">
      <p>Настройки применяются автоматически.</p>
      <p v-if="actionNotice">{{ actionNotice }}</p>
      <p v-else-if="!valid" class="text-danger">Введите целое число от 1 до {{ MAX_HISTORY_LIMIT.toLocaleString('ru-RU') }}.</p>
      <p v-else-if="saveStatus === 'pending'">Ожидание завершения ввода…</p>
      <p v-else-if="saveStatus === 'saving'">Применяется…</p>
      <p v-else-if="saveStatus === 'saved'">Изменения применены.</p>
      <p v-if="buffer.error" class="text-danger" role="alert">{{ buffer.error }}</p>
    </div>
    <div class="flex shrink-0 gap-1 border-b border-line" role="tablist" aria-label="Разделы настроек" @keydown="moveTab">
      <button v-for="(label, entry) in tabs" :id="`settings-${entry}-tab`" :key="entry" type="button" role="tab"
        class="min-h-10 border-b-2 px-2 text-xs font-medium" :class="tab === entry ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'"
        :aria-selected="tab === entry" :aria-controls="`settings-${entry}`" :tabindex="tab === entry ? 0 : -1" @click="tab = entry">
        {{ label }}
      </button>
    </div>
    <section v-show="tab === 'general'" id="settings-general" role="tabpanel" aria-labelledby="settings-general-tab" class="min-h-0 flex-1 overflow-auto" tabindex="0">
      <div class="flex flex-col gap-3">
        <div>
          <label for="history-limit" class="block py-1 text-[13px] font-semibold">Лимит истории</label>
          <p id="history-limit-help" class="text-xs leading-relaxed text-muted">Количество последних записей. По умолчанию — {{ HISTORY_LIMIT }}.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input id="history-limit" v-model.number="limit" type="number" min="1" :max="MAX_HISTORY_LIMIT" step="1" required
            class="min-h-10 w-32 rounded-lg border border-line bg-canvas px-3 text-[13px] tabular-nums outline-accent"
            aria-describedby="history-limit-help history-limit-range" :aria-invalid="!valid" :disabled="buffer.loading"
            @change="save" @blur="save" @keydown.enter.prevent="save" />
          <span id="history-limit-range" class="text-xs text-muted">от 1 до {{ MAX_HISTORY_LIMIT.toLocaleString('ru-RU') }}</span>
        </div>
        <p class="text-xs leading-relaxed text-muted">Лимит действует на обычные записи. Избранные закреплены сверху и сохраняются сверх лимита. Общий объём — до 32 МБ, одна запись — до 8 МБ.</p>
        <p v-if="valid && Number(limit) < ordinaryCount" class="rounded-lg bg-accent/8 px-3 py-2 text-xs leading-relaxed text-ink" role="status">
          При применении останутся {{ limit }} самых свежих обычных записей. Более старые записи будут удалены, избранные сохранятся.
        </p>
        <p v-if="!buffer.persistent" class="text-xs leading-relaxed text-muted">Шифрованное хранилище недоступно. Лимит и история действуют только до выхода из приложения.</p>
        <div class="mt-2 border-t border-line pt-3">
          <h3 class="mb-1 text-[13px] font-semibold">Импорт и экспорт</h3>
          <p class="text-xs leading-relaxed text-muted">История, избранное и настройки в обычном JSON без шифрования. Версия манифеста — {{ BACKUP_MANIFEST_VERSION }}. Изображения включены; файлы и папки сохраняются только как пути.</p>
          <div class="my-3 flex flex-wrap gap-2">
            <button type="button" class="export-history-button primary-button border border-accent/20 bg-accent/10 text-accent hover:bg-accent/20" :disabled="buffer.busy || buffer.loading" @click="transferHistory('export')"><AppIcon :path="mdiExport" class="size-4" />Экспорт JSON…</button>
            <button type="button" class="import-history-button primary-button border border-line bg-canvas hover:bg-selected" :disabled="buffer.busy || buffer.loading" @click="transferHistory('import')"><AppIcon :path="mdiImport" class="size-4" />Импорт JSON…</button>
          </div>
          <label class="flex items-start gap-2 text-xs leading-relaxed">
            <input v-model="importSettings" class="import-settings mt-0.5 accent-accent" type="checkbox" :disabled="buffer.busy || buffer.loading" />
            Применить настройки из файла при импорте
          </label>
          <p class="mt-2 text-xs leading-relaxed text-muted">Импорт объединяет истории без дубликатов. Действуют лимит записей и общий объём 32 МБ: более старые обычные записи могут быть удалены. Текущие избранные имеют приоритет.</p>
        </div>
        <div class="mt-2 border-t border-line pt-3">
          <h3 class="mb-1 text-[13px] font-semibold">Очистка истории</h3>
          <p class="mb-2 text-xs leading-relaxed text-muted">Удалить все записи, включая избранные. Настройки и состояние паузы сохранятся.</p>
          <button type="button" class="clear-history-button primary-button border border-danger/25 bg-danger/10 text-danger hover:bg-danger/20" :disabled="buffer.busy || buffer.loading || !buffer.clipboardHistory.length" @click="confirmClear"><AppIcon :path="mdiDeleteOutline" class="size-4" />Очистить всю историю…</button>
        </div>
      </div>
    </section>
    <section v-if="tab === 'shortcuts'" id="settings-shortcuts" role="tabpanel" aria-labelledby="settings-shortcuts-tab" class="min-h-0 flex-1 overflow-auto" tabindex="0">
      <ShortcutSettings @applied="actionNotice = 'Горячие клавиши применены.'" />
    </section>
    <section v-show="tab === 'about'" id="settings-about" role="tabpanel" aria-labelledby="settings-about-tab" class="min-h-0 flex-1 overflow-auto" tabindex="0">
      <div class="flex items-center gap-3 py-1">
        <span class="rounded-xl bg-accent/10 p-2.5 text-accent"><AppIcon :path="mdiClipboardTextOutline" :size="30" /></span>
        <div><h3 class="text-[17px] font-semibold tracking-tight">ClipClip Manager</h3><p class="text-xs text-muted">Версия {{ about.version }}</p></div>
      </div>
      <p class="mt-3 text-[13px] leading-relaxed">История буфера обмена для текста, изображений, файлов, ссылок и цветов. Поиск, просмотр и повторное копирование — в одном окне.</p>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs leading-relaxed">
        <dt class="text-muted">Автор</dt><dd>{{ about.author }}</dd>
        <dt class="text-muted">Вызов окна</dt><dd>{{ shortcutLabel(buffer.shortcuts.openWindow) }}</dd>
        <dt class="text-muted">Хранение</dt><dd>Локально, с шифрованием средствами ОС. Если шифрование недоступно — только в памяти до выхода.</dd>
      </dl>
      <h3 class="mt-5 mb-1 text-[13px] font-semibold">Лицензии</h3>
      <p class="mb-2 text-xs leading-relaxed text-muted">Нажмите на название, чтобы раскрыть лицензию. Все сведения доступны без интернета.</p>
      <details class="license-disclosure">
        <summary class="license-link">ClipClip · {{ about.license }}</summary>
        <pre class="license-text">{{ about.appLicense }}</pre>
      </details>
      <details v-for="component in about.components" :key="`${component.name}@${component.version}`" class="license-disclosure">
        <summary class="license-link">{{ component.name }} {{ component.version }} · {{ component.license }}</summary>
        <pre class="license-text">{{ component.text }}</pre>
      </details>
    </section>
    <dialog ref="clearDialog" class="clear-history-confirm m-auto max-h-[calc(100dvh_-_24px)] w-[calc(100%_-_32px)] max-w-md overflow-auto rounded-xl border border-line bg-surface p-4 text-ink shadow-xl"
      aria-labelledby="clear-title" aria-describedby="clear-description" @cancel.stop.prevent="clearDialog?.close()" @keydown.stop>
      <h3 id="clear-title" class="text-[15px] font-semibold">Очистить всю историю?</h3>
      <p id="clear-description" class="mt-3 text-xs leading-relaxed text-muted">Будут удалены все записи: {{ buffer.clipboardHistory.length }}, из них избранных: {{ favoriteCount }}. Отменить очистку нельзя. Содержимое системного буфера обмена сохранится.</p>
      <p v-if="buffer.error" role="alert" class="mt-2 text-xs text-danger">{{ buffer.error }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="cancel-clear text-button" autofocus :disabled="buffer.busy" @click="clearDialog?.close()">Отмена</button>
        <button type="button" class="confirm-clear primary-button bg-danger/10 text-danger hover:bg-danger/20" :disabled="buffer.busy" @click="clearHistory">Удалить всё</button>
      </div>
    </dialog>
  </dialog>
</template>
