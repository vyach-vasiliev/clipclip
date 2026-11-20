export interface DateTimeFilter {
  dateFrom: string
  dateTo: string
  timeFrom: string
  timeTo: string
}

export const emptyDateTimeFilter = (): DateTimeFilter => ({ dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' })
export const hasDateTimeFilter = (filter: DateTimeFilter) => Object.values(filter).some(Boolean)
export const MIN_FILTER_DATE = '0001-01-01'
export const MAX_FILTER_DATE = '9999-12-31'
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function localDateKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// A filter boundary represents a calendar day, independent of local clock changes.
export function parseFilterDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < MIN_FILTER_DATE || value > MAX_FILTER_DATE) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(`${value}T`) ? date : null
}

export function dateFilterError(filter: DateTimeFilter) {
  if ([filter.dateFrom, filter.dateTo].some(value => value && !parseFilterDate(value))) {
    return 'Укажите корректную дату с годом от 0001 до 9999.'
  }
  return filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo ? 'Дата «До» должна быть не раньше даты «С».' : ''
}

export function dateTimeMatcher(filter?: DateTimeFilter) {
  if (!filter || !hasDateTimeFilter(filter)) return () => true
  if (dateFilterError(filter)) return () => false
  const from = Number(filter.dateFrom.replaceAll('-', ''))
  const to = Number(filter.dateTo.replaceAll('-', ''))
  const { timeFrom, timeTo } = filter
  return (timestamp: number) => {
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return false
    const day = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
    if ((from && day < from) || (to && day > to)) return false
    if (!timeFrom && !timeTo) return true
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    return timeFrom && timeTo && timeFrom > timeTo
      ? time >= timeFrom || time <= timeTo
      : (!timeFrom || time >= timeFrom) && (!timeTo || time <= timeTo)
  }
}

export const matchesDateTime = (timestamp: number, filter: DateTimeFilter) => dateTimeMatcher(filter)(timestamp)

export function dateTimeFilterLabel(filter: DateTimeFilter) {
  const from = parseFilterDate(filter.dateFrom)
  const to = parseFilterDate(filter.dateTo)
  if ((filter.dateFrom && !from) || (filter.dateTo && !to)) return 'Некорректная дата'
  const day = from && to && filter.dateFrom === filter.dateTo ? dateFormatter.format(from)
    : [from ? `с ${dateFormatter.format(from)}` : '', to ? `до ${dateFormatter.format(to)}` : ''].filter(Boolean).join(' ')
  const time = filter.timeFrom && filter.timeTo ? `${filter.timeFrom}–${filter.timeTo}`
    : filter.timeFrom ? `с ${filter.timeFrom}` : filter.timeTo ? `до ${filter.timeTo}` : ''
  return [day, time].filter(Boolean).join(' · ')
}
