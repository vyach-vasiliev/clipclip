export const MAX_IMAGE_PIXELS = 16_000_000

export type EncodedImageFormat = 'image/png' | 'image/jpeg'
interface Dimensions { width: number; height: number }
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const jpegFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function dimensions(width: number, height: number): Dimensions | undefined {
  if (width > 0 && height > 0) return { width, height }
}

function pngDimensions(bytes: Buffer): Dimensions | undefined {
  // PNG requires an IHDR of exactly 13 bytes as its first chunk.
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return
  return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
}

function jpegDimensions(bytes: Buffer): Dimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return
  let offset = 2
  // Walk length-prefixed marker segments only up to the first frame header.
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0x01) continue // TEM is a stand-alone marker.
    if (marker < 0xc0 || marker >= 0xd0 && marker <= 0xda || offset + 2 > bytes.length) return
    const size = bytes.readUInt16BE(offset)
    if (size < 2 || offset + size > bytes.length) return
    if (jpegFrameMarkers.has(marker)) {
      if (size < 11 || size !== 8 + 3 * bytes[offset + 7]) return
      return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))
    }
    offset += size
  }
}

export function encodedImageDimensions(bytes: Buffer, format: EncodedImageFormat): Dimensions | undefined {
  return format === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes)
}

export function dibDimensions(header: Buffer, byteLength: number): Dimensions | undefined {
  if (header.length < 20) return
  const headerSize = header.readUInt32LE(0)
  // Chromium reads CF_DIB as BITMAPINFOHEADER, including its 40-byte base.
  if (headerSize < 40 || headerSize > byteLength) return
  const compression = header.readUInt32LE(16)
  // Embedded PNG and JPEG have their own dimensions, independent of the DIB.
  // Use only the dedicated encoded formats for those representations.
  if (compression === 4 || compression === 5) return
  // The negative height of a top-down DIB encodes its orientation.
  return dimensions(header.readInt32LE(4), Math.abs(header.readInt32LE(8)))
}

export function exceedsImagePixelLimit({ width, height }: Dimensions): boolean {
  return width > Math.floor(MAX_IMAGE_PIXELS / height)
}
