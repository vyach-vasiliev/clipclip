<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { mdiChevronLeft, mdiChevronRight, mdiClose } from '@mdi/js'
import AppIcon from './AppIcon.vue'
import { localDateKey, MAX_FILTER_DATE, MIN_FILTER_DATE, parseFilterDate } from '../utils/dateFilter'

const props = defineProps<{ type: 'date' | 'time'; label: string; modelValue: string }>()
const emit = defineEmits<{ select: [value: string]; close: [] }>()
const dialog = ref<HTMLDialogElement>()
const today = localDateKey(new Date())
const minYear = Number(MIN_FILTER_DATE.slice(0, 4))
const maxYear = Number(MAX_FILTER_DATE.slice(0, 4))
const dayFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
function calendarDate(year: number, month: number, day = 1) {
  const result = new Date(0)
  result.setUTCFullYear(year, month, day)
  return result
}
const dayKey = (date: Date) => date.toISOString().split('T')[0]
const validYear = (year: number) => year >= minYear && year <= maxYear
const initial = props.type === 'date' ? parseFilterDate(props.modelValue) : null
const cursor = ref(initial ?? parseFilterDate(today) ?? calendarDate(minYear, 0))
const month = ref(calendarDate(cursor.value.getUTCFullYear(), cursor.value.getUTCMonth()))
const monthLabel = computed(() => monthFormatter.format(month.value))
const calendarView = ref<'days' | 'months' | 'years'>('days')
const yearStart = ref(Math.floor(month.value.getUTCFullYear() / 12) * 12)
const yearRange = computed(() => `${Math.max(yearStart.value, minYear)}–${Math.min(yearStart.value + 11, maxYear)}`)
const monthNameFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' })
const months = Array.from({ length: 12 }, (_, index) => monthNameFormatter.format(calendarDate(2000, index)))
const years = computed(() => Array.from({ length: 12 }, (_, index) => yearStart.value + index))
const displayedMonth = computed(() => months[month.value.getUTCMonth()])
const days = computed(() => {
  const offset = (month.value.getUTCDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => {
    const date = calendarDate(month.value.getUTCFullYear(), month.value.getUTCMonth(), index - offset + 1)
    return { date, value: dayKey(date), label: date.getUTCDate(), outside: date.getUTCMonth() !== month.value.getUTCMonth(),
      disabled: !validYear(date.getUTCFullYear()), fullLabel: dayFormatter.format(date) }
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
function adjacentMonth(delta: number) {
  return calendarView.value === 'months'
    ? calendarDate(month.value.getUTCFullYear() + delta, month.value.getUTCMonth())
    : calendarDate(month.value.getUTCFullYear(), month.value.getUTCMonth() + delta)
}
function canMoveMonth(delta: number) {
  if (calendarView.value !== 'years') return validYear(adjacentMonth(delta).getUTCFullYear())
  const start = yearStart.value + delta * 12
  return start <= maxYear && start + 11 >= minYear
}
function moveMonth(delta: number) {
  if (!canMoveMonth(delta)) return
  if (calendarView.value === 'years') { yearStart.value += delta * 12; return }
  cursor.value = month.value = adjacentMonth(delta)
}
function toggleYearSelection() {
  if (calendarView.value === 'years') { calendarView.value = 'days'; return }
  yearStart.value = Math.floor(month.value.getUTCFullYear() / 12) * 12
  calendarView.value = 'years'
}
async function chooseYear(year: number) {
  if (!validYear(year)) return
  cursor.value = month.value = calendarDate(year, month.value.getUTCMonth())
  calendarView.value = 'months'
  await nextTick()
  dialog.value?.querySelector<HTMLButtonElement>('.calendar-month[aria-pressed="true"]')?.focus()
}
async function chooseMonth(index: number) {
  cursor.value = month.value = calendarDate(month.value.getUTCFullYear(), index)
  calendarView.value = 'days'
  await nextTick()
  focusCalendarCursor()
}
function focusCalendarCursor() {
  dialog.value?.querySelector<HTMLButtonElement>(`[data-day="${dayKey(cursor.value)}"]`)?.focus()
}
async function moveDate(event: KeyboardEvent) {
  const weekDay = (cursor.value.getUTCDay() + 6) % 7
  const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    Home: -weekDay, End: 6 - weekDay }
  if (!(event.key in offsets)) return
  event.preventDefault()
  const target = calendarDate(cursor.value.getUTCFullYear(), cursor.value.getUTCMonth(), cursor.value.getUTCDate() + offsets[event.key])
  if (!validYear(target.getUTCFullYear())) return
  cursor.value = target
  month.value = calendarDate(target.getUTCFullYear(), target.getUTCMonth())
  await nextTick()
  focusCalendarCursor()
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
  else focusCalendarCursor()
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
        <button type="button" class="picker-prev icon-button" :aria-label="calendarView === 'years' ? 'Предыдущие 12 лет' : calendarView === 'months' ? 'Предыдущий год' : 'Предыдущий месяц'" :disabled="!canMoveMonth(-1)" @click="moveMonth(-1)"><AppIcon :path="mdiChevronLeft" /></button>
        <div class="flex min-w-0 items-center gap-0.5">
          <button type="button" class="picker-month-toggle text-button min-w-0 capitalize" aria-label="Выбрать месяц" :aria-expanded="calendarView === 'months'" aria-controls="calendar-choices"
            @click="calendarView = calendarView === 'months' ? 'days' : 'months'">{{ displayedMonth }}</button>
          <button type="button" class="picker-year-toggle text-button tabular-nums" aria-label="Выбрать год" :aria-expanded="calendarView === 'years'" aria-controls="calendar-choices" @click="toggleYearSelection">{{ calendarView === 'years' ? yearRange : month.getUTCFullYear() }}</button>
        </div>
        <button type="button" class="picker-next icon-button" :aria-label="calendarView === 'years' ? 'Следующие 12 лет' : calendarView === 'months' ? 'Следующий год' : 'Следующий месяц'" :disabled="!canMoveMonth(1)" @click="moveMonth(1)"><AppIcon :path="mdiChevronRight" /></button>
      </div>
      <p class="sr-only" aria-live="polite">{{ calendarView === 'years' ? `Выбор года: ${yearRange}` : calendarView === 'months' ? `Выбор месяца: ${month.getUTCFullYear()}` : monthLabel }}</p>
      <div id="calendar-choices" class="min-h-68">
      <div v-if="calendarView === 'days'" class="grid grid-cols-7 text-center">
        <span v-for="day in ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']" :key="day" class="py-2 text-[11px] text-muted" aria-hidden="true">{{ day }}</span>
        <button v-for="day in days" :key="day.value" type="button" :data-day="day.value" :disabled="day.disabled" class="calendar-day min-h-10 min-w-0 rounded-lg text-xs tabular-nums disabled:opacity-30"
          :class="[day.value === modelValue ? 'bg-accent text-surface hover:bg-accent' : day.outside ? 'text-muted/60 hover:bg-accent/10' : 'text-ink hover:bg-accent/10', day.value === today && day.value !== modelValue ? 'ring-1 ring-accent/40 ring-inset' : '']"
          :aria-label="day.fullLabel" :aria-pressed="day.value === modelValue" :aria-current="day.value === today ? 'date' : undefined" :tabindex="!day.disabled && day.value === dayKey(cursor) ? 0 : -1"
          @focus="cursor = day.date" @keydown="moveDate" @click="select(day.value)">{{ day.label }}</button>
      </div>
      <div v-else-if="calendarView === 'months'" class="grid grid-cols-3 gap-1" aria-label="Месяцы">
        <button v-for="(label, index) in months" :key="label" type="button" :data-month="index" class="calendar-month min-h-14 rounded-lg px-1 text-xs capitalize"
          :class="index === month.getUTCMonth() ? 'bg-accent/15 font-semibold text-accent' : 'text-ink hover:bg-accent/10'" :aria-pressed="index === month.getUTCMonth()" @click="chooseMonth(index)">{{ label }}</button>
      </div>
      <div v-else class="grid grid-cols-3 gap-1" aria-label="Годы">
        <button v-for="year in years" :key="year" type="button" :data-year="year" :disabled="!validYear(year)" class="calendar-year min-h-14 rounded-lg px-1 text-xs tabular-nums disabled:opacity-30"
          :class="year === month.getUTCFullYear() ? 'bg-accent/15 font-semibold text-accent' : 'text-ink hover:bg-accent/10'" :aria-pressed="year === month.getUTCFullYear()" @click="chooseYear(year)">{{ year }}</button>
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
