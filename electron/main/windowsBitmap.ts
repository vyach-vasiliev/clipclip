import { dibDimensions, exceedsImagePixelLimit, MAX_IMAGE_PIXELS } from './imageDimensions'

const BI_RGB = 0
const BI_RLE8 = 1
const BI_RLE4 = 2
const BI_BITFIELDS = 3
const BI_ALPHABITFIELDS = 6
const BASE_HEADER = 40
export const MAX_DIB_HEADER_BYTES = 124
const supportedHeaders = new Set([BASE_HEADER, 52, 56, 108, MAX_DIB_HEADER_BYTES])
// Uncompressed DIB rows may take four bytes per pixel even with padding. The
// extra space accommodates metadata and RLE commands. The PNG limit is checked
// separately, after decoding, just as it is for other clipboard images.
const MAX_DIB_BYTES = MAX_IMAGE_PIXELS * 4 + 1024 * 1024

function dibLayout(header: Buffer, availableBytes: number) {
  const size = dibDimensions(header, availableBytes)
  if (!size || exceedsImagePixelLimit(size) || header.length < BASE_HEADER || header.readUInt16LE(12) !== 1) return
  const headerBytes = header.readUInt32LE(0)
  if (!supportedHeaders.has(headerBytes) || header.length < headerBytes) return

  const bits = header.readUInt16LE(14)
  const compression = header.readUInt32LE(16)
  const topDown = header.readInt32LE(8) < 0
  const rle = compression === BI_RLE4 || compression === BI_RLE8
  const hasMasks = compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS
  if (compression === BI_RGB) {
    if (![1, 4, 8, 16, 24, 32].includes(bits)) return
  } else if (rle) {
    if (topDown || bits !== (compression === BI_RLE4 ? 4 : 8)) return
  } else if (!hasMasks || (bits !== 16 && bits !== 32)) return

  const externalMasks = hasMasks && headerBytes === BASE_HEADER ? (compression === BI_ALPHABITFIELDS ? 16 : 12) : 0
  const paletteOffset = headerBytes + externalMasks
  const indexed = bits <= 8
  const colors = header.readUInt32LE(32) || (indexed ? 1 << bits : 0)
  if (indexed && colors > 1 << bits) return
  const pixelOffset = paletteOffset + colors * 4
  const stride = Math.ceil(size.width * bits / 32) * 4
  const pixelBytes = rle ? header.readUInt32LE(20) : stride * size.height
  const byteLength = pixelOffset + pixelBytes
  if (!pixelBytes || byteLength > availableBytes || byteLength > MAX_DIB_BYTES) return
  return { ...size, bits, compression, topDown, rle, hasMasks, paletteOffset, colors, pixelOffset, stride, byteLength }
}

export function dibSnapshotLength(header: Buffer, availableBytes: number) {
  return dibLayout(header, availableBytes)?.byteLength
}

function channel(mask: number) {
  if (!mask) return
  const shift = 31 - Math.clz32(mask & -mask)
  const max = mask >>> shift
  if ((max & (max + 1)) !== 0) return
  return (sample: number) => Math.round(((sample & mask) >>> shift) * 255 / max)
}

function dibChannels(bytes: Buffer, hasMasks: boolean, paletteOffset: number, bits: number, compression: number) {
  const redMask = hasMasks ? bytes.readUInt32LE(40) : 0x7c00
  const greenMask = hasMasks ? bytes.readUInt32LE(44) : 0x03e0
  const blueMask = hasMasks ? bytes.readUInt32LE(48) : 0x001f
  const alphaMask = hasMasks && paletteOffset >= 56 ? bytes.readUInt32LE(52) : 0
  const red = channel(redMask)
  const green = channel(greenMask)
  const blue = channel(blueMask)
  const alpha = channel(alphaMask)
  let occupied = 0
  for (const mask of [redMask, greenMask, blueMask, alphaMask]) {
    if (occupied & mask || (bits === 16 && mask > 0xffff)) return
    occupied |= mask
  }
  if (!red || !green || !blue || (alphaMask && !alpha) || (compression === BI_ALPHABITFIELDS && !alpha)) return
  return { red, green, blue, alpha }
}

function decodeRle(bytes: Buffer, layout: NonNullable<ReturnType<typeof dibLayout>>, palette: Uint32Array, pixels: Uint32Array) {
  const { width, height, bits } = layout
  let offset = layout.pixelOffset
  let x = 0
  let y = 0
  pixels.fill(0xff000000)
  while (offset + 2 <= layout.byteLength) {
    const run = bytes[offset++]
    const code = bytes[offset++]
    if (run === 0 && code === 1) return true
    if (run === 0 && code === 0) {
      if (y === height) return false
      x = 0
      y++
      continue
    }
    if (run === 0 && code === 2) {
      if (offset + 2 > layout.byteLength) return false
      x += bytes[offset++]
      y += bytes[offset++]
      if (x > width || y >= height) return false
      continue
    }

    const count = run || code
    const literalBytes = run ? 0 : Math.ceil(count * bits / 8)
    const paddedBytes = literalBytes + literalBytes % 2
    if (y >= height || x + count > width || offset + paddedBytes > layout.byteLength) return false
    const row = (height - 1 - y) * width + x
    for (let pixel = 0; pixel < count; pixel++) {
      const value = run ? code : bytes[offset + (bits === 4 ? pixel >> 1 : pixel)]
      const index = bits === 4 ? (pixel % 2 ? value & 15 : value >> 4) : value
      if (index >= palette.length) return false
      pixels[row + pixel] = palette[index]
    }
    x += count
    offset += paddedBytes
  }
  return false
}

/** Convert only the owned, validated snapshot to Electron's premultiplied BGRA. */
export function decodeDib(bytes: Buffer) {
  const layout = dibLayout(bytes, bytes.length)
  if (!layout) return
  const { width, height, bits, hasMasks, compression, paletteOffset, colors, stride, topDown, pixelOffset, rle } = layout
  const channels = hasMasks || bits === 16 ? dibChannels(bytes, hasMasks, paletteOffset, bits, compression) : undefined
  if ((hasMasks || bits === 16) && !channels) return
  const palette = Uint32Array.from({ length: bits <= 8 ? colors : 0 }, (_, index) =>
    bytes.readUInt32LE(paletteOffset + index * 4) | 0xff000000)
  const pixels = Buffer.allocUnsafe(width * height * 4)
  const output = new Uint32Array(pixels.buffer, pixels.byteOffset, width * height)
  if (rle) return decodeRle(bytes, layout, palette, output) ? { width, height, pixels } : undefined

  if (bits === 32 && !hasMasks) {
    for (let y = 0; y < height; y++) {
      const start = pixelOffset + (topDown ? y : height - 1 - y) * stride
      bytes.copy(pixels, y * width * 4, start, start + stride)
    }
    // Match the usual Windows fallback for undefined alpha in 32-bit BI_RGB.
    let hasAlpha = false
    let invalidAlpha = false
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3]
      hasAlpha ||= alpha !== 0
      if (pixels[offset] > alpha || pixels[offset + 1] > alpha || pixels[offset + 2] > alpha) {
        invalidAlpha = true
        break
      }
    }
    if (!hasAlpha || invalidAlpha) {
      for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255
    }
    return { width, height, pixels }
  }

  for (let y = 0; y < height; y++) {
    const source = pixelOffset + (topDown ? y : height - 1 - y) * stride
    const target = y * width
    for (let x = 0; x < width; x++) {
      if (channels) {
        const sample = bits === 16 ? bytes.readUInt16LE(source + x * 2) : bytes.readUInt32LE(source + x * 4)
        const alpha = channels.alpha?.(sample) ?? 255
        const red = Math.round(channels.red(sample) * alpha / 255)
        const green = Math.round(channels.green(sample) * alpha / 255)
        const blue = Math.round(channels.blue(sample) * alpha / 255)
        output[target + x] = alpha << 24 | red << 16 | green << 8 | blue
      } else if (bits === 24) {
        const offset = source + x * 3
        output[target + x] = 0xff000000 | bytes[offset + 2] << 16 | bytes[offset + 1] << 8 | bytes[offset]
      } else {
        const bit = x * bits
        const value = bytes[source + (bit >> 3)]
        const index = value >> (8 - bits - bit % 8) & ((1 << bits) - 1)
        if (index >= palette.length) return
        output[target + x] = palette[index]
      }
    }
  }
  return { width, height, pixels }
}
