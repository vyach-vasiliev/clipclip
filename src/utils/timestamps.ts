import type { ClipboardHistoryItem } from '../../shared/clipboard'
import type { TimeFormat } from '../../shared/time'
import { localDateKey } from './dateFilter'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const compactDateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const timeFormatters = {
  '24h': new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  '12h': new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h12' }),
}

export function formatTimestamp(timestamp: number, format: TimeFormat) {
  const date = new Date(timestamp)
  const valid = Number.isFinite(date.getTime())
  return {
    day: valid ? localDateKey(date) : undefined,
    datetime: valid ? date.toISOString() : undefined,
    date: valid ? compactDateFormatter.format(date) : 'Дата неизвестна',
    fullDate: valid ? dateFormatter.format(date) : 'Дата неизвестна',
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

export function historyDateGroups(items: ClipboardHistoryItem[], format: TimeFormat) {
  const groups: { key: string; pinned: boolean; day?: string; dateLabel: string; records: ReturnType<typeof historyTimestamps> }[] = []
  const occurrences = new Map<string, number>()
  for (const row of historyTimestamps(items, format)) {
    if (row.item.pinned) {
      if (!groups.at(-1)?.pinned) groups.push({ key: 'favorites', pinned: true, dateLabel: 'Избранное', records: [] })
      groups[groups.length - 1].records.push(row)
      continue
    }
    if (row.dateLabel) {
      const base = `history:${row.day ?? 'unknown'}`
      const occurrence = occurrences.get(base) ?? 0
      occurrences.set(base, occurrence + 1)
      groups.push({ key: `${base}:${occurrence}`, pinned: false, day: row.day, dateLabel: row.dateLabel, records: [] })
    }
    groups[groups.length - 1].records.push(row)
  }
  return groups
}
