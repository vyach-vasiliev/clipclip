<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mdiClose, mdiClipboardTextOutline } from '@mdi/js'
import about, { electronNoticesUrl } from 'virtual:clipclip-licenses'
import { HISTORY_LIMIT, MAX_HISTORY_LIMIT, isHistoryLimit } from '../../shared/clipboard'
import { useBufferStore } from '../store/buffer'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ close: [] }>()
const buffer = useBufferStore()
const dialog = ref<HTMLDialogElement>()
const tab = ref<'general' | 'about'>('general')
const limit = ref<number | string>(buffer.historyLimit)
const saveStatus = ref<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
const valid = computed(() => isHistoryLimit(limit.value))
const changed = computed(() => limit.value !== buffer.historyLimit)
const notices = ref('')
const noticesLoading = ref(false)
const noticesError = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let inFlight: Promise<boolean> | undefined
let disposed = false
function cancelTimer() { clearTimeout(saveTimer); saveTimer = undefined }
function scheduleSave() {
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
  tab.value = event.key === 'Home' ? 'general' : event.key === 'End' ? 'about' : tab.value === 'general' ? 'about' : 'general'
  dialog.value?.querySelector<HTMLButtonElement>(`#settings-${tab.value}-tab`)?.focus()
}
async function loadNotices(event: Event) {
  if (!(event.target as HTMLDetailsElement).open || notices.value || noticesLoading.value) return
  noticesLoading.value = true
  noticesError.value = false
  try {
    const response = await fetch(electronNoticesUrl)
    if (!response.ok) throw new Error('License notices unavailable')
    // Treat the shipped HTML as inert text; never mount third-party markup or links.
    const document = new DOMParser().parseFromString(await response.text(), 'text/html')
    notices.value = Array.from(document.querySelectorAll('.product'))
      .map(product => `${product.querySelector('.title')?.textContent?.trim() ?? ''}\n\n${product.querySelector('.license')?.textContent?.trim() ?? ''}`)
      .join('\n\n────────────────────────\n\n')
    if (!notices.value) throw new Error('Empty license notices')
  } catch { noticesError.value = true }
  finally { noticesLoading.value = false }
}
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => { disposed = true; cancelTimer(); void save(); dialog.value?.close() })
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
      <p v-if="!valid" class="text-danger">Введите целое число от 1 до {{ MAX_HISTORY_LIMIT.toLocaleString('ru-RU') }}.</p>
      <p v-else-if="saveStatus === 'pending'">Ожидание завершения ввода…</p>
      <p v-else-if="saveStatus === 'saving'">Применяется…</p>
      <p v-else-if="saveStatus === 'saved'">Изменения применены.</p>
      <p v-if="buffer.error" class="text-danger" role="alert">{{ buffer.error }}</p>
    </div>
    <div class="flex shrink-0 gap-1 border-b border-line" role="tablist" aria-label="Разделы настроек" @keydown="moveTab">
      <button v-for="entry in (['general', 'about'] as const)" :id="`settings-${entry}-tab`" :key="entry" type="button" role="tab"
        class="min-h-10 border-b-2 px-3 text-xs font-medium" :class="tab === entry ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'"
        :aria-selected="tab === entry" :aria-controls="`settings-${entry}`" :tabindex="tab === entry ? 0 : -1" @click="tab = entry">
        {{ entry === 'general' ? 'Основные' : 'О программе' }}
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
        <p class="text-xs leading-relaxed text-muted">При заполнении истории удаляются самые старые записи. Общий объём — до 32 МБ, одна запись — до 8 МБ.</p>
        <p v-if="valid && Number(limit) < buffer.clipboardHistory.length" class="rounded-lg bg-accent/8 px-3 py-2 text-xs leading-relaxed text-ink" role="status">
          При применении останутся {{ limit }} самых свежих записей. Более старые записи будут удалены.
        </p>
        <p v-if="!buffer.persistent" class="text-xs leading-relaxed text-muted">Шифрованное хранилище недоступно. Лимит и история действуют только до выхода из приложения.</p>
      </div>
    </section>
    <section v-show="tab === 'about'" id="settings-about" role="tabpanel" aria-labelledby="settings-about-tab" class="min-h-0 flex-1 overflow-auto" tabindex="0">
      <div class="flex items-center gap-3 py-1">
        <span class="rounded-xl bg-accent/10 p-2.5 text-accent"><AppIcon :path="mdiClipboardTextOutline" :size="30" /></span>
        <div><h3 class="text-[17px] font-semibold tracking-tight">ClipClip Manager</h3><p class="text-xs text-muted">Версия {{ about.version }}</p></div>
      </div>
      <p class="mt-3 text-[13px] leading-relaxed">История буфера обмена для текста, изображений, файлов, ссылок и цветов. Поиск, просмотр и повторное копирование — в одном окне.</p>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs leading-relaxed">
        <dt class="text-muted">Автор</dt><dd>{{ about.author }}</dd>
        <dt class="text-muted">Вызов окна</dt><dd>Ctrl + Alt + B</dd>
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
      <details class="license-disclosure electron-notices" @toggle="loadNotices">
        <summary class="license-link">Chromium, Node.js и другие компоненты Electron</summary>
        <p v-if="noticesLoading" class="py-2 text-xs text-muted" role="status">Загрузка лицензий…</p>
        <div v-else-if="noticesError" class="py-2 text-xs text-danger" role="alert">Не удалось загрузить лицензии. Закройте и раскройте блок ещё раз.</div>
        <pre v-else-if="notices" class="license-text">{{ notices }}</pre>
      </details>
    </section>
  </dialog>
</template>
