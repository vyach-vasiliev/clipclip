export type TimeFormat = '24h' | '12h'
export const DEFAULT_TIME_FORMAT: TimeFormat = '24h'

export function isTimeFormat(value: unknown): value is TimeFormat {
  return value === '24h' || value === '12h'
}
