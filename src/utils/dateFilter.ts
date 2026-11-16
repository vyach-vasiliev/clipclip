export interface DateTimeFilter {
  dateFrom: string
  dateTo: string
  timeFrom: string
  timeTo: string
}

export const emptyDateTimeFilter = (): DateTimeFilter => ({ dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' })
export const hasDateTimeFilter = (filter: DateTimeFilter) => Object.values(filter).some(Boolean)

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateFilterError(filter: DateTimeFilter) {
  return filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo ? 'Дата «До» должна быть не раньше даты «С».' : ''
}

export function matchesDateTime(timestamp: number, filter: DateTimeFilter) {
  if (!hasDateTimeFilter(filter)) return true
  if (dateFilterError(filter)) return false
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return false
  const day = localDateKey(date)
  if ((filter.dateFrom && day < filter.dateFrom) || (filter.dateTo && day > filter.dateTo)) return false
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (filter.timeFrom && filter.timeTo && filter.timeFrom > filter.timeTo) {
    return time >= filter.timeFrom || time <= filter.timeTo
  }
  return (!filter.timeFrom || time >= filter.timeFrom) && (!filter.timeTo || time <= filter.timeTo)
}

export function dateTimeFilterLabel(filter: DateTimeFilter) {
  const format = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
  const day = filter.dateFrom && filter.dateTo && filter.dateFrom === filter.dateTo ? format(filter.dateFrom)
    : [filter.dateFrom ? `с ${format(filter.dateFrom)}` : '', filter.dateTo ? `до ${format(filter.dateTo)}` : ''].filter(Boolean).join(' ')
  const time = filter.timeFrom && filter.timeTo ? `${filter.timeFrom}–${filter.timeTo}`
    : filter.timeFrom ? `с ${filter.timeFrom}` : filter.timeTo ? `до ${filter.timeTo}` : ''
  return [day, time].filter(Boolean).join(' · ')
}
