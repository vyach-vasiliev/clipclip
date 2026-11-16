import { describe, expect, it } from 'vitest'
import type { ClipboardHistoryItem } from '../shared/clipboard'
import { historyDateGroups, historyTimestamps } from '../src/utils/timestamps'

const item = (id: string, date: Date, pinned = false): ClipboardHistoryItem => ({
  id, createdAt: date.getTime(), pinned, type: 'text', data: id,
  params: { size: '1 симв.', type: 'text', source: { name: 'Fixture', title: '' }, tags: [] },
})

describe('history timestamps in the local timezone', () => {
  it('groups whole date series for sticky headers and preserves their keys when a new record arrives', () => {
    const items = [item('favorite', new Date(2026, 10, 15, 16), true), item('new', new Date(2026, 10, 15, 14)),
      item('same', new Date(2026, 10, 15, 8)), item('older', new Date(2026, 10, 14, 23))]
    const groups = historyDateGroups(items, '24h')
    expect(groups.map(group => group.records.map(row => row.item.id))).toEqual([['favorite'], ['new', 'same'], ['older']])
    expect(groups.map(group => group.day)).toEqual([undefined, '2026-11-15', '2026-11-14'])
    expect(new Set(groups.map(group => group.key)).size).toBe(3)
    const updated = historyDateGroups([items[0], item('incoming', new Date(2026, 10, 15, 15)), ...items.slice(1)], '24h')
    expect(updated.map(group => group.key)).toEqual(groups.map(group => group.key))
    expect(historyDateGroups([], '24h')).toEqual([])
  })
  it('keeps favorites from different dates together without separate date headers', () => {
    const groups = historyDateGroups([item('favorite-new', new Date(2026, 10, 15, 14, 30), true),
      item('favorite-old', new Date(2026, 9, 1, 8), true)], '12h')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ pinned: true, dateLabel: 'Избранное' })
    expect(groups[0].day).toBeUndefined()
    expect(groups[0].records.map(row => `${row.date} · ${row.time}`)).toEqual(['15.11.2026 · 02:30 PM', '01.10.2026 · 08:00 AM'])
  })
  it('separates consecutive local days, including year boundaries, without changing record order', () => {
    const items = [item('new', new Date(2027, 0, 1, 0, 1)), item('previous', new Date(2026, 11, 31, 23, 59)), item('same', new Date(2026, 11, 31, 8))]
    const rows = historyTimestamps(items, '24h')
    expect(rows.map(row => row.item.id)).toEqual(['new', 'previous', 'same'])
    expect(rows.map(row => row.day)).toEqual(['2027-01-01', '2026-12-31', '2026-12-31'])
    expect(rows.map(row => row.dateLabel)).toEqual(['1 января 2027 г.', '31 декабря 2026 г.', null])
    expect(rows.map(row => row.time)).toEqual(['00:01', '23:59', '08:00'])
    expect(rows[0].datetime).toBe(items[0].createdAt ? new Date(items[0].createdAt).toISOString() : '')
  })
  it('uses AM/PM correctly at midnight, noon and in the afternoon', () => {
    const items = [0, 12, 14, 23].map(hour => item(String(hour), new Date(2026, 10, 15, hour, 5)))
    expect(historyTimestamps(items, '12h').map(row => row.time)).toEqual(['12:05 AM', '12:05 PM', '02:05 PM', '11:05 PM'])
  })
  it('starts a new date series after favorites and after filtering', () => {
    const items = [item('favorite', new Date(2026, 10, 15, 8), true), item('normal', new Date(2026, 10, 15, 7))]
    expect(historyTimestamps(items, '24h').every(row => row.dateLabel)).toBe(true)
    expect(historyTimestamps(items.slice(1), '24h')[0].dateLabel).toBe('15 ноября 2026 г.')
    expect(historyTimestamps([], '24h')).toEqual([])
  })
  it('handles timestamps outside the supported date range without breaking the list', () => {
    const row = historyTimestamps([item('invalid', new Date(NaN))], '24h')[0]
    expect(row).toMatchObject({ time: '—', dateLabel: 'Дата неизвестна', datetime: undefined })
  })
})
