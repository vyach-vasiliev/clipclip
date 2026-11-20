<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { mdiCalendarClockOutline, mdiCalendarOutline, mdiClockOutline, mdiClose } from '@mdi/js'
import AppIcon from './AppIcon.vue'
import DateTimePickerDialog from './DateTimePickerDialog.vue'
import { dateFilterError, dateTimeFilterLabel, emptyDateTimeFilter, hasDateTimeFilter, localDateKey, MAX_FILTER_DATE, MIN_FILTER_DATE, type DateTimeFilter } from '../utils/dateFilter'

const props = defineProps<{ modelValue: DateTimeFilter; resultCount: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: DateTimeFilter] }>()
const dialog = ref<HTMLDialogElement>()
const opened = ref(false)
const trigger = ref<HTMLButtonElement>()
const active = computed(() => hasDateTimeFilter(props.modelValue))
const error = computed(() => dateFilterError(props.modelValue))
const overnight = computed(() => props.modelValue.timeFrom && props.modelValue.timeTo && props.modelValue.timeFrom > props.modelValue.timeTo)
const fields = [
  { key: 'dateFrom', label: 'Дата с', type: 'date' }, { key: 'dateTo', label: 'Дата до', type: 'date' },
  { key: 'timeFrom', label: 'Время с', type: 'time' }, { key: 'timeTo', label: 'Время до', type: 'time' },
] as const
const picker = ref<(typeof fields)[number] | null>(null)
function update(key: keyof DateTimeFilter, event: Event) {
  emit('update:modelValue', { ...props.modelValue, [key]: (event.target as HTMLInputElement).value })
}
function picked(value: string) {
  if (picker.value) emit('update:modelValue', { ...props.modelValue, [picker.value.key]: value })
}
function preset(days: number, yesterday = false) {
  const end = new Date()
  if (yesterday) end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  emit('update:modelValue', { ...emptyDateTimeFilter(), dateFrom: localDateKey(start), dateTo: localDateKey(end) })
}
function close() { dialog.value?.close(); opened.value = false; trigger.value?.focus() }
async function open() { opened.value = true; await nextTick(); dialog.value?.showModal() }
defineExpose({ open })
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <div class="date-time-filter h-full shrink-0">
    <button ref="trigger" type="button" class="date-filter-toggle search-action-button relative" :class="active ? 'text-accent' : ''"
      aria-label="Поиск по дате и времени" title="Поиск по дате и времени" aria-haspopup="dialog" @click="open">
      <AppIcon :path="mdiCalendarClockOutline" />
      <span v-if="active" class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent" aria-hidden="true" />
    </button>
    <dialog v-if="opened" ref="dialog" class="date-filter-dialog m-auto max-h-[calc(100dvh_-_24px)] w-[calc(100%_-_24px)] max-w-md overflow-auto rounded-xl border border-line bg-surface p-3 text-ink shadow-xl"
      aria-labelledby="date-filter-title" @keydown.stop @paste.stop @cancel.stop.prevent="close">
      <header class="mb-2 flex items-center justify-between gap-2">
        <h2 id="date-filter-title" class="text-[15px] font-semibold text-balance">Поиск по дате и времени</h2>
        <button type="button" class="icon-button" aria-label="Закрыть фильтр даты и времени" @click="close"><AppIcon :path="mdiClose" /></button>
      </header>
      <div class="mb-3 flex flex-wrap gap-1" aria-label="Быстрый выбор даты">
        <button type="button" class="date-preset-today text-button" @click="preset(1)">Сегодня</button>
        <button type="button" class="date-preset-yesterday text-button" @click="preset(1, true)">Вчера</button>
        <button type="button" class="date-preset-week text-button" @click="preset(7)">7 дней</button>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div v-for="field in fields" :key="field.key" class="block min-w-0 text-xs text-muted">
          <label :for="`filter-${field.key}`" class="mb-1 block">{{ field.label }}</label>
          <span class="flex min-h-10 min-w-0 items-stretch overflow-hidden rounded-lg border border-line bg-canvas focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
            <input :id="`filter-${field.key}`" :type="field.type" :value="modelValue[field.key]" :step="field.type === 'time' ? 60 : undefined"
              :min="field.type === 'date' ? MIN_FILTER_DATE : undefined" :max="field.type === 'date' ? MAX_FILTER_DATE : undefined"
              class="date-time-input w-full min-w-0 flex-1 bg-transparent px-2 text-[13px] text-ink tabular-nums outline-none"
              :aria-invalid="field.type === 'date' && !!error" :aria-describedby="error && field.type === 'date' ? 'date-filter-error' : 'date-filter-help'"
              @input="update(field.key, $event)" />
            <button type="button" class="picker-open inline-flex min-h-10 w-10 shrink-0 items-center justify-center text-muted hover:bg-accent/8 hover:text-accent"
              :data-picker="field.key" :aria-label="(field.type === 'date' ? 'Открыть календарь. ' : 'Выбрать время. ') + field.label" aria-haspopup="dialog" @click="picker = field">
              <AppIcon :path="field.type === 'date' ? mdiCalendarOutline : mdiClockOutline" class="size-4" />
            </button>
          </span>
        </div>
      </div>
      <p id="date-filter-help" class="mt-3 text-xs leading-relaxed text-pretty text-muted">По местному времени, в каждом выбранном дне. Любое поле можно оставить пустым.</p>
      <p v-if="overnight" class="mt-1 text-xs text-muted">Время через полночь: с {{ modelValue.timeFrom }} до {{ modelValue.timeTo }}.</p>
      <p v-if="error" id="date-filter-error" class="mt-2 text-xs text-danger" role="alert">{{ error }}</p>
      <p v-else-if="active" class="mt-2 text-xs text-muted tabular-nums">{{ dateTimeFilterLabel(modelValue) }}</p>
      <footer class="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        <button type="button" class="date-filter-reset text-button" :disabled="!active" @click="emit('update:modelValue', emptyDateTimeFilter())">Сбросить</button>
        <button type="button" class="date-filter-show primary-button" :disabled="!!error" @click="close">Показать: <span class="tabular-nums">{{ resultCount }}</span></button>
      </footer>
      <DateTimePickerDialog v-if="picker" :type="picker.type" :label="picker.label" :model-value="modelValue[picker.key]" @select="picked" @close="picker = null" />
    </dialog>
  </div>
</template>
