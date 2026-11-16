<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { mdiChevronLeft, mdiChevronRight, mdiClose } from '@mdi/js'
import AppIcon from './AppIcon.vue'
import { localDateKey } from '../utils/dateFilter'

const props = defineProps<{ type: 'date' | 'time'; label: string; modelValue: string }>()
const emit = defineEmits<{ select: [value: string]; close: [] }>()
const dialog = ref<HTMLDialogElement>()
const initial = props.type === 'date' && props.modelValue ? new Date(`${props.modelValue}T12:00:00`) : new Date()
const cursor = ref(Number.isFinite(initial.getTime()) ? initial : new Date())
const month = ref(new Date(cursor.value.getFullYear(), cursor.value.getMonth(), 1))
const today = localDateKey(new Date())
const monthLabel = computed(() => new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(month.value))
const calendarView = ref<'days' | 'months' | 'years'>('days')
const yearStart = ref(Math.floor(month.value.getFullYear() / 12) * 12)
const months = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(new Date(2026, index, 1)))
const years = computed(() => Array.from({ length: 12 }, (_, index) => yearStart.value + index))
const displayedMonth = computed(() => months[month.value.getMonth()])
const days = computed(() => {
  const offset = (month.value.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(month.value.getFullYear(), month.value.getMonth(), index - offset + 1, 12)
    return { date, value: localDateKey(date), label: date.getDate(), outside: date.getMonth() !== month.value.getMonth(),
      fullLabel: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date) }
  })
})
const hour = ref(Number(props.modelValue.split(':')[0]) || 0)
const minute = ref(Number(props.modelValue.split(':')[1]) || 0)
const pad = (value: number) => String(value).padStart(2, '0')
function close() { dialog.value?.close(); emit('close') }
function handleKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    if (!event.repeat) close()
  }
}
function select(value: string) { emit('select', value); close() }
function moveMonth(delta: number) {
  if (calendarView.value === 'years') { yearStart.value += delta * 12; return }
  if (calendarView.value === 'months') {
    month.value = new Date(month.value.getFullYear() + delta, month.value.getMonth(), 1)
    cursor.value = new Date(month.value)
    return
  }
  month.value = new Date(month.value.getFullYear(), month.value.getMonth() + delta, 1)
  cursor.value = new Date(month.value)
}
function toggleYearSelection() {
  if (calendarView.value === 'years') { calendarView.value = 'days'; return }
  yearStart.value = Math.floor(month.value.getFullYear() / 12) * 12
  calendarView.value = 'years'
}
async function chooseYear(year: number) {
  month.value = new Date(year, month.value.getMonth(), 1)
  cursor.value = new Date(month.value)
  calendarView.value = 'months'
  await nextTick()
  dialog.value?.querySelector<HTMLButtonElement>('.calendar-month[aria-pressed="true"]')?.focus()
}
async function chooseMonth(index: number) {
  month.value = new Date(month.value.getFullYear(), index, 1)
  cursor.value = new Date(month.value)
  calendarView.value = 'days'
  await nextTick()
  dialog.value?.querySelector<HTMLButtonElement>(`[data-day="${localDateKey(cursor.value)}"]`)?.focus()
}
async function moveDate(event: KeyboardEvent) {
  const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    Home: -(cursor.value.getDay() + 6) % 7, End: 6 - (cursor.value.getDay() + 6) % 7 }
  if (!(event.key in offsets)) return
  event.preventDefault()
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth(), cursor.value.getDate() + offsets[event.key], 12)
  month.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth(), 1)
  await nextTick()
  dialog.value?.querySelector<HTMLButtonElement>(`[data-day="${localDateKey(cursor.value)}"]`)?.focus()
}
async function scrollTime() {
  await nextTick()
  dialog.value?.querySelectorAll('[aria-selected="true"]').forEach(element => element.scrollIntoView({ block: 'nearest' }))
}
function selectTime(part: 'hour' | 'minute', value: number) {
  if (part === 'hour') hour.value = value
  else minute.value = value
  void scrollTime()
}
function moveTime(event: KeyboardEvent, part: 'hour' | 'minute') {
  const target = part === 'hour' ? hour : minute
  const count = part === 'hour' ? 24 : 60
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  target.value = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (target.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
  void scrollTime()
}
onMounted(async () => {
  dialog.value?.showModal()
  if (props.type === 'time') await scrollTime()
  else dialog.value?.querySelector<HTMLButtonElement>(`[data-day="${localDateKey(cursor.value)}"]`)?.focus()
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="date-time-picker m-auto max-h-[calc(100dvh_-_24px)] w-[calc(100%_-_16px)] max-w-sm overflow-auto rounded-xl border border-line bg-surface p-2.5 text-ink shadow-xl"
    aria-labelledby="picker-title" @keydown="handleKeydown" @paste.stop @cancel.stop.prevent="close">
    <header class="mb-2 flex items-center justify-between gap-2">
      <h3 id="picker-title" class="text-[15px] font-semibold">{{ label }}</h3>
      <button type="button" class="icon-button" aria-label="Закрыть выбор" @click="close"><AppIcon :path="mdiClose" /></button>
    </header>
    <template v-if="type === 'date'">
      <div class="mb-2 flex items-center justify-between gap-2">
        <button type="button" class="picker-prev icon-button" :aria-label="calendarView === 'years' ? 'Предыдущие 12 лет' : calendarView === 'months' ? 'Предыдущий год' : 'Предыдущий месяц'" @click="moveMonth(-1)"><AppIcon :path="mdiChevronLeft" /></button>
        <div class="flex min-w-0 items-center gap-0.5">
          <button type="button" class="picker-month-toggle text-button min-w-0 capitalize" aria-label="Выбрать месяц" :aria-expanded="calendarView === 'months'" aria-controls="calendar-choices"
            @click="calendarView = calendarView === 'months' ? 'days' : 'months'">{{ displayedMonth }}</button>
          <button type="button" class="picker-year-toggle text-button tabular-nums" aria-label="Выбрать год" :aria-expanded="calendarView === 'years'" aria-controls="calendar-choices" @click="toggleYearSelection">{{ calendarView === 'years' ? `${yearStart}–${yearStart + 11}` : month.getFullYear() }}</button>
        </div>
        <button type="button" class="picker-next icon-button" :aria-label="calendarView === 'years' ? 'Следующие 12 лет' : calendarView === 'months' ? 'Следующий год' : 'Следующий месяц'" @click="moveMonth(1)"><AppIcon :path="mdiChevronRight" /></button>
      </div>
      <p class="sr-only" aria-live="polite">{{ calendarView === 'years' ? `Выбор года: ${yearStart}–${yearStart + 11}` : calendarView === 'months' ? `Выбор месяца: ${month.getFullYear()}` : monthLabel }}</p>
      <div id="calendar-choices" class="min-h-68">
      <div v-if="calendarView === 'days'" class="grid grid-cols-7 text-center">
        <span v-for="day in ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']" :key="day" class="py-2 text-[11px] text-muted" aria-hidden="true">{{ day }}</span>
        <button v-for="day in days" :key="day.value" type="button" :data-day="day.value" class="calendar-day min-h-10 min-w-0 rounded-lg text-xs tabular-nums"
          :class="[day.value === modelValue ? 'bg-accent text-surface hover:bg-accent' : day.outside ? 'text-muted/60 hover:bg-accent/10' : 'text-ink hover:bg-accent/10', day.value === today && day.value !== modelValue ? 'ring-1 ring-accent/40 ring-inset' : '']"
          :aria-label="day.fullLabel" :aria-pressed="day.value === modelValue" :aria-current="day.value === today ? 'date' : undefined" :tabindex="day.value === localDateKey(cursor) ? 0 : -1"
          @focus="cursor = day.date" @keydown="moveDate" @click="select(day.value)">{{ day.label }}</button>
      </div>
      <div v-else-if="calendarView === 'months'" class="grid grid-cols-3 gap-1" aria-label="Месяцы">
        <button v-for="(label, index) in months" :key="label" type="button" :data-month="index" class="calendar-month min-h-14 rounded-lg px-1 text-xs capitalize"
          :class="index === month.getMonth() ? 'bg-accent/15 font-semibold text-accent' : 'text-ink hover:bg-accent/10'" :aria-pressed="index === month.getMonth()" @click="chooseMonth(index)">{{ label }}</button>
      </div>
      <div v-else class="grid grid-cols-3 gap-1" aria-label="Годы">
        <button v-for="year in years" :key="year" type="button" :data-year="year" class="calendar-year min-h-14 rounded-lg px-1 text-xs tabular-nums"
          :class="year === month.getFullYear() ? 'bg-accent/15 font-semibold text-accent' : 'text-ink hover:bg-accent/10'" :aria-pressed="year === month.getFullYear()" @click="chooseYear(year)">{{ year }}</button>
      </div>
      </div>
      <footer class="mt-2 flex justify-between border-t border-line pt-2">
        <button type="button" class="text-button" @click="select('')">Очистить</button>
        <button type="button" class="picker-today text-button" @click="select(today)">Сегодня</button>
      </footer>
    </template>
    <template v-else>
      <p class="mb-3 text-center text-2xl font-medium text-accent tabular-nums">{{ pad(hour) }}:{{ pad(minute) }}</p>
      <div class="grid grid-cols-2 gap-3">
        <div v-for="part in (['hour', 'minute'] as const)" :key="part" class="min-w-0">
          <p :id="`picker-${part}-label`" class="mb-1.5 text-center text-xs text-muted">{{ part === 'hour' ? 'Часы' : 'Минуты' }}</p>
          <div :class="`picker-${part}-list`" class="h-50 overflow-y-auto rounded-lg border border-line bg-canvas p-1" role="listbox" tabindex="0"
            :aria-labelledby="`picker-${part}-label`" :aria-activedescendant="`picker-${part}-${part === 'hour' ? hour : minute}`" @keydown="moveTime($event, part)">
            <div v-for="value in (part === 'hour' ? 24 : 60)" :id="`picker-${part}-${value - 1}`" :key="value" role="option" :data-value="value - 1"
              :aria-selected="(part === 'hour' ? hour : minute) === value - 1" class="flex min-h-10 cursor-pointer items-center justify-center rounded-md text-[13px] tabular-nums hover:bg-accent/10"
              :class="(part === 'hour' ? hour : minute) === value - 1 ? 'bg-accent/15 font-semibold text-accent' : 'text-ink'"
              @click="selectTime(part, value - 1)">{{ pad(value - 1) }}</div>
          </div>
        </div>
      </div>
      <footer class="mt-3 flex justify-between border-t border-line pt-3">
        <button type="button" class="text-button" @click="select('')">Очистить</button>
        <button type="button" class="picker-apply primary-button" @click="select(`${pad(hour)}:${pad(minute)}`)">Выбрать</button>
      </footer>
    </template>
  </dialog>
</template>
