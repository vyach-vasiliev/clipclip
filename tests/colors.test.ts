import Color from 'colorjs.io'
import { describe, expect, it } from 'vitest'
import { COLOR_FORMATS, colorSwatch, convertColor, isColorFormat, parseColor } from '../shared/colors'

describe('standalone CSS colors', () => {
  it.each(['#abc', '#abcd', '#bdbde9', '#bdbde980', 'rgb(189, 189, 233)', 'rgba(189, 189, 233, .5)',
    'rgb(74% 74% 91% / 50%)', 'hsl(240 50% 70%)', 'hsla(240, 50%, 70%, .5)', 'hsl(.5turn 50% 70%)',
    'hwb(240 20% 10% / .5)', 'lab(70% 10 -20)', 'lch(70% 30 240)', 'oklab(.7 .1 -.1)',
    'oklch(70% .1 240 / .5)', 'color(srgb .84 .84 .84)', 'color(srgb-linear .5 .2 .1 / .5)',
    'color(display-p3 1 0 .5)', 'color(rec2020 .5 .3 .2)', 'color(xyz-d50 .3 .4 .5)',
    'rebeccapurple', 'transparent', '  #BDBDE9\n', 'oklch(50% 0 none)'])('recognizes %s', text => {
    expect(parseColor(text)).not.toBeNull()
    expect(colorSwatch(text)).toMatch(/^oklch\(/)
  })
  it.each(['', 'hello', '123456', '#12345', '#gggggg', 'color: red;', 'prefix #fff', '#fff suffix',
    'rgb(1 2)', 'rgb(1 2 3) trailing', 'currentColor', 'inherit', 'var(--color)', 'url(https://example.test)',
    'rgb(1e999 0 0)', 'color(--hsv 0 1 1)', 'a'.repeat(513)])('ignores %s', text => {
    expect(parseColor(text)).toBeNull()
    expect(colorSwatch(text)).toBeNull()
  })
  it('converts the example to readable numeric RGB and full HEX', () => {
    expect(convertColor('rgb(189, 189, 233)', 'hex')).toBe('#bdbde9')
    expect(convertColor('#bdbde9', 'rgb')).toBe('rgb(189 189 233)')
  })
  it.each(COLOR_FORMATS)('keeps color and alpha when converting to %s', format => {
    const original = new Color('#bdbde980')
    const converted = new Color(convertColor('#bdbde980', format))
    expect(converted.alpha).toBeCloseTo(original.alpha!, 5)
    const coords = converted.to('srgb').coords
    coords.forEach((channel, index) => expect(channel).toBeCloseTo(original.coords[index]!, 4))
  })
  it('preserves wide gamut in perceptual spaces and maps RGB formats consistently', () => {
    const text = 'color(display-p3 1 0 0 / .4)'
    expect(new Color(colorSwatch(text)!).inGamut('srgb')).toBe(false)
    expect(new Color(convertColor(text, 'oklch')).deltaEOK(new Color(text))).toBeLessThan(.00001)
    const rgb = new Color(convertColor(text, 'rgb'))
    expect(rgb.inGamut('srgb')).toBe(true)
    for (const format of ['hsl', 'hwb', 'srgb'] as const) {
      expect(new Color(convertColor(text, format)).deltaEOK(rgb)).toBeLessThan(.00001)
    }
    expect(convertColor(text, 'p3')).toBe('color(display-p3 1 0 0 / 0.4)')
  })
  it('does not accept arbitrary output formats or non-colors', () => {
    expect(isColorFormat('hex')).toBe(true)
    for (const format of ['toString', '__proto__', '', null, {}]) expect(isColorFormat(format)).toBe(false)
    expect(() => convertColor('some text', 'hex')).toThrow()
  })
})
