import { describe, expect, it } from 'vitest'
import { dateFilterError, emptyDateTimeFilter, matchesDateTime } from '../src/utils/dateFilter'

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
})
