import type { ClipboardHistoryItem } from '../../shared/clipboard'
import type { TimeFormat } from '../../shared/time'
import { localDateKey } from './dateFilter'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const compactDateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const timeFormatters = {
  '24h': new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  '12h': new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h12' }),
}
const MAX_CACHED_TIMESTAMPS = 20_000

type CachedTimestamp = {
  date: Date
  valid: boolean
  day?: string
  formatted: Partial<Record<TimeFormat, ReturnType<typeof formatDate>>>
  fullDate?: string
}

const timestampCache = new Map<number, CachedTimestamp>()

function timestampInfo(value: number) {
  let cached = timestampCache.get(value)
  if (!cached) {
    const date = new Date(value)
    const valid = Number.isFinite(date.getTime())
    const year = date.getFullYear()
    cached = { date, valid, day: valid && year >= 1 && year <= 9999 ? localDateKey(date) : undefined, formatted: {} }
    if (timestampCache.size === MAX_CACHED_TIMESTAMPS) timestampCache.delete(timestampCache.keys().next().value!)
    timestampCache.set(value, cached)
  }
  return cached
}

export function historyDayLabel(value: number) {
  const timestamp = timestampInfo(value)
  return timestamp.fullDate ??= timestamp.valid ? dateFormatter.format(timestamp.date) : 'Дата неизвестна'
}

export function formatTimestamp(timestamp: number, format: TimeFormat) {
  const cached = timestampInfo(timestamp)
  return cached.formatted[format] ??= formatDate(cached, format, historyDayLabel(timestamp))
}

function formatDate({ date, day, valid }: Pick<CachedTimestamp, 'date' | 'day' | 'valid'>, format: TimeFormat, fullDate: string) {
  return {
    day,
    datetime: valid ? date.toISOString() : undefined,
    date: valid ? compactDateFormatter.format(date) : 'Дата неизвестна',
    fullDate,
    time: valid ? timeFormatters[format].format(date) : '—',
  }
}

export function historyTimestamps(items: ClipboardHistoryItem[], format: TimeFormat) {
  let previousDay = ''
  return items.map((item, index) => {
    const timestamp = formatTimestamp(item.createdAt, format)
    const day = timestamp.day ?? ''
    // Favorites remain at the top; start a fresh date series at that boundary.
    const separator = index === 0 || day !== previousDay || !!item.pinned !== !!items[index - 1].pinned
    previousDay = day
    return { item, ...timestamp, dateLabel: separator ? timestamp.fullDate : null }
  })
}

export function groupHistory(items: ClipboardHistoryItem[]) {
  const groups: { key: string; pinned: boolean; day?: string; records: ClipboardHistoryItem[] }[] = []
  const occurrences = new Map<string, number>()
  for (const item of items) {
    const pinned = !!item.pinned
    const day = pinned ? undefined : timestampInfo(item.createdAt).day
    let group = groups.at(-1)
    if (!group || group.pinned !== pinned || group.day !== day) {
      const base = pinned ? 'favorites' : `history:${day ?? 'unknown'}`
      const occurrence = occurrences.get(base) ?? 0
      occurrences.set(base, occurrence + 1)
      group = { key: pinned && occurrence === 0 ? base : `${base}:${occurrence}`, pinned, day, records: [] }
      groups.push(group)
    }
    group.records.push(item)
  }
  return groups
}

export function historyDateGroups(items: ClipboardHistoryItem[], format: TimeFormat) {
  return groupHistory(items).map(group => ({
    ...group,
    dateLabel: group.pinned ? 'Избранное' : historyDayLabel(group.records[0].createdAt),
    records: historyTimestamps(group.records, format),
  }))
}
