import { readFileSync } from 'node:fs'
import koffi from 'koffi'
import { describe, expect, it, vi } from 'vitest'
import { dibDimensions, encodedImageDimensions, exceedsImagePixelLimit } from '../electron/main/imageDimensions'
import { createWindowsClipboardAccess, readAllowedClipboard } from '../electron/main/windowsClipboard'
import { decodeDib, dibSnapshotLength } from '../electron/main/windowsBitmap'

function bitmap({ width, height, bits, pixels, compression = 0, masks, palette, headerBytes = 40 }: {
  width: number; height: number; bits: number; pixels: number[]; compression?: number
  masks?: number[]; palette?: number[]; headerBytes?: number
}) {
  const header = Buffer.alloc(headerBytes)
  header.writeUInt32LE(headerBytes)
  header.writeInt32LE(width, 4)
  header.writeInt32LE(height, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(bits, 14)
  header.writeUInt32LE(compression, 16)
  header.writeUInt32LE(pixels.length, 20)
  header.writeUInt32LE(palette ? palette.length / 4 : 0, 32)
  const masksBytes = Buffer.alloc((masks?.length ?? 0) * 4)
  masks?.forEach((mask, index) => masksBytes.writeUInt32LE(mask, index * 4))
  if (headerBytes > 40) masksBytes.copy(header, 40)
  return Buffer.concat([header, ...(headerBytes === 40 ? [masksBytes] : []), Buffer.from(palette ?? []), Buffer.from(pixels)])
}

describe('clipboard image preflight', () => {
  it('reads the bundled PNG dimensions without decoding its pixels', () => {
    const png = readFileSync(new URL('../public/notepad.png', import.meta.url))
    expect(encodedImageDimensions(png, 'image/png')).toEqual({ width: 64, height: 64 })
    expect(encodedImageDimensions(png.subarray(0, 24), 'image/png')).toBeUndefined()
    expect(encodedImageDimensions(png, 'image/jpeg')).toBeUndefined()
  })

  it.each([0xc0, 0xc2])('walks metadata to a JPEG frame marker 0x%s', marker => {
    // SOI, an APP segment, and one frame header with a single component.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0xff, marker, 0, 11, 8, 0, 6, 0, 8, 1, 1, 0x11, 0])
    expect(encodedImageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 8, height: 6 })
    expect(encodedImageDimensions(jpeg.subarray(0, -1), 'image/jpeg')).toBeUndefined()
  })

  it('handles top-down Windows bitmaps and bounds decoded pixel counts', () => {
    const header = Buffer.alloc(40)
    header.writeUInt32LE(header.length)
    header.writeInt32LE(320, 4)
    header.writeInt32LE(-240, 8)
    expect(dibDimensions(header, header.length)).toEqual({ width: 320, height: 240 })
    expect(dibDimensions(header, header.length - 1)).toBeUndefined()
    expect(exceedsImagePixelLimit({ width: 4_000, height: 4_000 })).toBe(false)
    expect(exceedsImagePixelLimit({ width: 4_001, height: 4_000 })).toBe(true)
  })

  it('decodes an owned 24-bit bitmap with bottom-up rows and stride padding', () => {
    const dib = bitmap({ width: 1, height: 2, bits: 24, pixels: [255, 0, 0, 0, 0, 0, 255, 0] })
    expect(dibSnapshotLength(dib.subarray(0, 40), dib.length)).toBe(dib.length)
    expect(decodeDib(dib)).toEqual({ width: 1, height: 2, pixels: Buffer.from([0, 0, 255, 255, 255, 0, 0, 255]) })
    expect(decodeDib(dib.subarray(0, -1))).toBeUndefined()
  })

  it('preserves meaningful top-down alpha and treats omitted BI_RGB alpha as opaque', () => {
    const alpha = bitmap({ width: 1, height: -2, bits: 32, pixels: [18, 12, 64, 128, 5, 1, 10, 255] })
    expect(decodeDib(alpha)?.pixels).toEqual(Buffer.from([18, 12, 64, 128, 5, 1, 10, 255]))
    const opaque = bitmap({ width: 1, height: 1, bits: 32, pixels: [42, 14, 99, 0] })
    expect(decodeDib(opaque)?.pixels).toEqual(Buffer.from([42, 14, 99, 255]))
  })

  it('converts 16-bit bitfields and premultiplies explicit V5 alpha', () => {
    const rgb565 = bitmap({ width: 1, height: 1, bits: 16, compression: 3, masks: [0xf800, 0x07e0, 0x001f], pixels: [0xe0, 0x07, 0, 0] })
    expect(decodeDib(rgb565)?.pixels).toEqual(Buffer.from([0, 255, 0, 255]))
    const alpha = bitmap({ width: 1, height: -1, bits: 32, compression: 3, headerBytes: 124,
      masks: [0xff0000, 0x00ff00, 0x0000ff, 0xff000000], pixels: [0, 0, 255, 128] })
    expect(decodeDib(alpha)?.pixels).toEqual(Buffer.from([0, 0, 128, 128]))
  })

  it.each([[4, 0x10], [8, 1]])('decodes %i-bit palettes in RGB and RLE storage', (bits, redIndex) => {
    const palette = [0, 0, 0, 0, 0, 0, 255, 0]
    const expected = Buffer.from([0, 0, 255, 255, 0, 0, bits === 8 ? 255 : 0, 255])
    const rgb = bitmap({ width: 2, height: 1, bits, palette, pixels: [redIndex, bits === 8 ? 1 : 0, 0, 0] })
    const rle = bitmap({ width: 2, height: 1, bits, palette, compression: bits === 8 ? 1 : 2, pixels: [2, redIndex, 0, 1] })
    expect(decodeDib(rgb)?.pixels).toEqual(expected)
    expect(decodeDib(rle)?.pixels).toEqual(expected)
  })
})

describe('Windows clipboard history privacy', () => {
  it.runIf(process.platform === 'win32')('binds and registers Windows clipboard formats without reading clipboard data', () => {
    const access = createWindowsClipboardAccess()
    expect(access.readPolicy).toBeTypeOf('function')
    expect(access.readImage).toBeTypeOf('function')
  })

  it('returns an empty observation for an exclusion without reading clipboard contents', async () => {
    const read = vi.fn(async () => 'fixture item')
    const access = { sequence: () => 12, readPolicy: () => 'excluded' as const }
    await expect(readAllowedClipboard(access, read, '')).resolves.toBe('')
    expect(read).not.toHaveBeenCalled()
  })

  it('leaves the baseline untouched on a lock conflict or a change during the policy check', async () => {
    const read = vi.fn(async () => 'fixture item')
    await expect(readAllowedClipboard({ sequence: () => 12, readPolicy: () => 'unavailable' }, read, '')).resolves.toBeUndefined()
    const sequence = vi.fn().mockReturnValueOnce(12).mockReturnValue(13)
    await expect(readAllowedClipboard({ sequence, readPolicy: () => 'allowed' }, read, '')).resolves.toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })

  it('publishes only content from the revision that passed the privacy check', async () => {
    let sequence = 12
    const access = { sequence: () => sequence, readPolicy: () => 'allowed' as const }
    await expect(readAllowedClipboard(access, async () => 'fixture item', '')).resolves.toBe('fixture item')
    await expect(readAllowedClipboard(access, async isCurrent => {
      expect(isCurrent()).toBe(true)
      sequence++
      expect(isCurrent()).toBe(false)
      return 'other fixture item'
    }, '')).resolves.toBeUndefined()
  })

  it('honors both native flags and releases clipboard memory on every policy decision', () => {
    const formats = new Map<string, number>()
    const available = new Set<number>()
    const bytes = new ArrayBuffer(4)
    const check = vi.fn(() => 1)
    const close = vi.fn()
    const getData = vi.fn(() => 42)
    const unlock = vi.fn()
    const functions: Record<string, unknown> = {
      GetClipboardSequenceNumber: () => 12,
      RegisterClipboardFormatW: (name: string) => {
        const format = formats.size + 1
        formats.set(name, format)
        return format
      },
      OpenClipboard: check,
      CloseClipboard: close,
      IsClipboardFormatAvailable: (format: number) => available.has(format),
      GetClipboardData: getData,
      GlobalSize: () => bytes.byteLength,
      GlobalLock: () => 42,
      GlobalUnlock: unlock,
    }
    const load = vi.spyOn(koffi, 'load').mockReturnValue({
      func: (signature: string) => functions[signature.match(/__stdcall (\w+)/)![1]],
    } as unknown as ReturnType<typeof koffi.load>)
    const decode = vi.spyOn(koffi, 'decode').mockImplementation((...args) => new Uint8Array(bytes).slice(0, Number(args[2])))
    try {
      const access = createWindowsClipboardAccess()
      expect(access.readPolicy()).toBe('allowed')
      available.add(formats.get('CanIncludeInClipboardHistory')!)
      expect(access.readPolicy()).toBe('excluded')
      new DataView(bytes).setUint32(0, 1, true)
      expect(access.readPolicy()).toBe('allowed')
      available.add(formats.get('ExcludeClipboardContentFromMonitorProcessing')!)
      expect(access.readPolicy()).toBe('excluded')
      check.mockReturnValueOnce(0)
      expect(access.readPolicy()).toBe('unavailable')
      expect(getData).toHaveBeenCalledTimes(2)
      expect(unlock).toHaveBeenCalledTimes(2)
      expect(close).toHaveBeenCalledTimes(4)
    } finally {
      load.mockRestore()
      decode.mockRestore()
    }
  })
})

describe('Windows clipboard image representations', () => {
  it('falls back from unavailable PNG to a DIB copied before native memory was released', () => {
    const dib = bitmap({ width: 1, height: 1, bits: 24, pixels: [10, 30, 50, 0] })
    const nativeBytes = Uint8Array.from(dib)
    const formats = new Map<string, number>()
    const getData = vi.fn((format: number) => format === 8 ? 42 : 0)
    const unlock = vi.fn(() => nativeBytes.fill(0))
    const close = vi.fn()
    const functions: Record<string, unknown> = {
      GetClipboardSequenceNumber: () => 12,
      RegisterClipboardFormatW: (name: string) => {
        const format = 0xc000 + formats.size
        formats.set(name, format)
        return format
      },
      OpenClipboard: () => 1,
      CloseClipboard: close,
      IsClipboardFormatAvailable: (format: number) => format === 8 || format === formats.get('PNG'),
      GetClipboardData: getData,
      GlobalSize: () => nativeBytes.byteLength,
      GlobalLock: () => 42,
      GlobalUnlock: unlock,
    }
    const load = vi.spyOn(koffi, 'load').mockReturnValue({
      func: (signature: string) => functions[signature.match(/__stdcall (\w+)/)![1]],
    } as unknown as ReturnType<typeof koffi.load>)
    const decode = vi.spyOn(koffi, 'decode').mockImplementation((...args) => nativeBytes.slice(0, Number(args[2])))
    try {
      const captured = createWindowsClipboardAccess().readImage()
      expect(getData.mock.calls).toEqual([[formats.get('PNG')], [8]])
      expect(unlock).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
      expect(captured).toEqual({ status: 'bitmap', bytes: dib })
      if (captured?.status === 'bitmap') expect(decodeDib(captured.bytes)?.pixels).toEqual(Buffer.from([10, 30, 50, 255]))
    } finally {
      load.mockRestore()
      decode.mockRestore()
    }
  })
})
