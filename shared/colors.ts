import Color from 'colorjs.io'

export const COLOR_FORMATS = ['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'srgb', 'p3'] as const
export type ColorFormat = typeof COLOR_FORMATS[number]
export const COLOR_LABELS: Record<ColorFormat, string> = {
  hex: 'HEX', rgb: 'RGB', hsl: 'HSL', hwb: 'HWB', lab: 'Lab', lch: 'LCH',
  oklab: 'OKLab', oklch: 'OKLCH', srgb: 'sRGB', p3: 'Display P3',
}

export function isColorFormat(value: unknown): value is ColorFormat {
  return typeof value === 'string' && COLOR_FORMATS.includes(value as ColorFormat)
}

export function parseColor(text: string): Color | null {
  // Clipboard records can be megabytes long. Only inspect standalone CSS colors.
  if (text.length > 512) return null
  const value = text.trim()
  if (!/^(?:#[\da-f]+|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([\s\S]*\)|color\(\s*(?:srgb(?:-linear)?|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz(?:-d50|-d65)?)\s+[\s\S]*\))$/i.test(value)) return null
  try {
    const color = new Color(value)
    if (!color.coords.every(channel => channel === null || Number.isFinite(channel))
      || !(color.alpha === null || Number.isFinite(color.alpha))) return null
    return color
  } catch { return null }
}

export function colorSwatch(text: string): string | null {
  const color = parseColor(text)
  // Preserve wide-gamut colors in Chromium, independent of the source notation.
  return color ? color.to('oklch').toString({ precision: 6, inGamut: false }) : null
}

export function convertColor(text: string, format: ColorFormat): string {
  const color = parseColor(text)
  if (!color || !isColorFormat(format)) throw new Error('Не удалось преобразовать цвет.')
  // RGB-derived formats share one CSS gamut mapping, so their swatches agree.
  const rgb = color.to('srgb').toGamut({ method: 'css' })
  const options = { precision: 6, inGamut: false }
  if (format === 'hex') return rgb.toString({ format: 'hex', collapse: false })
  if (format === 'rgb') return rgb.toString({ ...options, format: {
    name: 'rgb', coords: ['<number>[0, 255]', '<number>[0, 255]', '<number>[0, 255]'],
  } })
  if (format === 'hsl' || format === 'hwb') return rgb.to(format).toString(options)
  if (format === 'srgb') return rgb.toString({ ...options, format: 'color' })
  // Unbounded spaces retain the source color instead of first reducing to sRGB.
  return color.to(format).toString(options)
}
