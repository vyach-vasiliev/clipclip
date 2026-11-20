import { describe, expect, it } from 'vitest'
import { dateFilterError, dateTimeFilterLabel, emptyDateTimeFilter, matchesDateTime, parseFilterDate } from '../src/utils/dateFilter'

const stamp = (day: number, hour = 12, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).getTime()
describe('local date and time filtering', () => {
  it('includes the entire selected date, including its last minute', () => {
    const filter = { ...emptyDateTimeFilter(), dateFrom: '2026-11-15', dateTo: '2026-11-15' }
    expect([stamp(14, 23, 59), stamp(15, 0), stamp(15, 23, 59, 59), stamp(16, 0)].map(value => matchesDateTime(value, filter))).toEqual([false, true, true, false])
  })
  it('combines a date range with inclusive minute boundaries', () => {
    const filter = { dateFrom: '2026-11-14', dateTo: '2026-11-15', timeFrom: '14:00', timeTo: '14:30' }
    expect([stamp(14, 13, 59), stamp(14, 14), stamp(15, 14, 30, 59), stamp(15, 14, 31), stamp(16, 14)].map(value => matchesDateTime(value, filter))).toEqual([false, true, true, false, false])
  })
  it('supports time alone across days and a range crossing midnight', () => {
    const filter = { ...emptyDateTimeFilter(), timeFrom: '23:00', timeTo: '01:00' }
    expect([stamp(14, 23), stamp(15, 0), stamp(16, 1), stamp(15, 12)].map(value => matchesDateTime(value, filter))).toEqual([true, true, true, false])
  })
  it('supports open boundaries and reports reversed dates', () => {
    expect(matchesDateTime(stamp(15, 8), { ...emptyDateTimeFilter(), dateFrom: '2026-11-14', timeTo: '09:00' })).toBe(true)
    expect(matchesDateTime(stamp(15, 8), { ...emptyDateTimeFilter(), dateTo: '2026-11-14' })).toBe(false)
    const reversed = { ...emptyDateTimeFilter(), dateFrom: '2026-11-16', dateTo: '2026-11-15' }
    expect(dateFilterError(reversed)).toContain('не раньше')
    expect(matchesDateTime(stamp(15), reversed)).toBe(false)
    expect(matchesDateTime(NaN, { ...emptyDateTimeFilter(), timeFrom: '01:00' })).toBe(false)
    expect(matchesDateTime(stamp(15), emptyDateTimeFilter())).toBe(true)
  })
  it.each(['10000-01-01', '0000-12-31', '2026-02-29', '2026-04-31', '2026-13-01'])('rejects invalid calendar date %s without throwing during formatting', dateFrom => {
    const filter = { ...emptyDateTimeFilter(), dateFrom }
    expect(parseFilterDate(dateFrom)).toBeNull()
    expect(dateFilterError(filter)).toContain('корректную дату')
    expect(dateTimeFilterLabel(filter)).toBe('Некорректная дата')
    expect(matchesDateTime(stamp(15), filter)).toBe(false)
  })
  it('filters early four-digit year spellings and compares boundaries in chronological order', () => {
    expect(parseFilterDate('0004-02-29')?.toISOString()).toBe('0004-02-29T00:00:00.000Z')
    expect(parseFilterDate('0100-02-29')).toBeNull()
    const early = new Date(0)
    early.setFullYear(1, 0, 1)
    const future = new Date(0)
    future.setFullYear(10000, 0, 1)
    const filter = { ...emptyDateTimeFilter(), dateFrom: '0001-01-01', dateTo: '9999-12-31' }
    expect(dateFilterError(filter)).toBe('')
    expect(matchesDateTime(early.getTime(), filter)).toBe(true)
    expect(matchesDateTime(future.getTime(), filter)).toBe(false)
  })
})
