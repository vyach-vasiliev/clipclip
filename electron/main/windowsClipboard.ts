import koffi from 'koffi'
import { MAX_ITEM_BYTES } from '../../shared/clipboard'
import { dibDimensions, exceedsImagePixelLimit, type EncodedImageFormat } from './imageDimensions'
import { dibSnapshotLength, MAX_DIB_HEADER_BYTES } from './windowsBitmap'

type HistoryPolicy = 'allowed' | 'excluded' | 'unavailable'
type NativeImageRead =
  | { status: 'encoded'; format: EncodedImageFormat; bytes: Buffer }
  | { status: 'bitmap'; bytes: Buffer }
  | { status: 'empty' | 'invalid' | 'byte-limit' | 'pixel-limit' }

interface ClipboardPrivacy {
  sequence(): number
  readPolicy(): HistoryPolicy
}

export interface WindowsClipboardAccess extends ClipboardPrivacy {
  readImage(): NativeImageRead | undefined
}

export async function readAllowedClipboard<T>(
  access: ClipboardPrivacy, read: (isCurrent: () => boolean) => Promise<T | undefined>, excluded: T,
): Promise<T | undefined> {
  const sequence = access.sequence()
  if (!sequence) return
  const isCurrent = () => access.sequence() === sequence
  const policy = access.readPolicy()
  if (policy === 'unavailable' || !isCurrent()) return
  if (policy === 'excluded') return excluded
  const snapshot = await read(isCurrent)
  if (isCurrent()) return snapshot
}

const CF_DIB = 8

export function createWindowsClipboardAccess(): WindowsClipboardAccess {
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const sequence = user32.func('uint32_t __stdcall GetClipboardSequenceNumber()')
  const register = user32.func('uint32_t __stdcall RegisterClipboardFormatW(str16 name)')
  const open = user32.func('int __stdcall OpenClipboard(uintptr_t window)')
  const close = user32.func('int __stdcall CloseClipboard()')
  const has = user32.func('int __stdcall IsClipboardFormatAvailable(uint32_t format)')
  const data = user32.func('uintptr_t __stdcall GetClipboardData(uint32_t format)')
  const sizeOf = kernel32.func('size_t __stdcall GlobalSize(uintptr_t memory)')
  const lock = kernel32.func('void * __stdcall GlobalLock(uintptr_t memory)')
  const unlock = kernel32.func('int __stdcall GlobalUnlock(uintptr_t memory)')
  const excludedFormat = register('ExcludeClipboardContentFromMonitorProcessing')
  const historyFormat = register('CanIncludeInClipboardHistory')
  const pngFormat = register('PNG')
  const jpegFormats = ['JFIF', 'JPEG', 'image/jpeg'].map(name => register(name))
  if (!excludedFormat || !historyFormat || !pngFormat) throw new Error('Windows clipboard format registration failed')

  function withClipboard<T>(read: () => T): T | undefined {
    if (!open(0)) return
    try { return read() }
    finally { close() }
  }

  function withData<T>(format: number, read: (size: number, copyBytes: (length: number) => Buffer) => T): T | undefined {
    const memory = data(format)
    if (!memory) return
    const size = Number(sizeOf(memory))
    if (!size) return
    const pointer = lock(memory)
    if (!pointer) return
    try {
      return read(size, length => {
        // Electron forbids external ArrayBuffers, so copy while the handle is locked.
        const bytes = koffi.decode(pointer, 'uint8_t', length) as Uint8Array
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      })
    }
    finally { unlock(memory) }
  }

  function readEncoded(format: number, mime: EncodedImageFormat): NativeImageRead | undefined {
    return withData<NativeImageRead>(format, (size, copyBytes) => size > MAX_ITEM_BYTES
      ? { status: 'byte-limit' }
      : { status: 'encoded', bytes: copyBytes(size), format: mime })
  }

  return {
    sequence: () => sequence(),
    readPolicy() {
      return withClipboard<HistoryPolicy>(() => {
        if (has(excludedFormat)) return 'excluded'
        if (!has(historyFormat)) return 'allowed'
        const value = withData(historyFormat, (size, copyBytes) => size >= 4 ? copyBytes(4).readUInt32LE(0) : undefined)
        if (value === 0) return 'excluded'
        return value === 1 ? 'allowed' : 'unavailable'
      }) ?? 'unavailable'
    },
    readImage() {
      return withClipboard<NativeImageRead>(() => {
        // Electron's getType(image/*) decodes internally. Read encoded Windows
        // formats directly, keeping Chromium's PNG and CF_DIB preference.
        const hasPng = has(pngFormat)
        if (hasPng) {
          const png = readEncoded(pngFormat, 'image/png')
          if (png) return png
        }
        if (has(CF_DIB)) {
          return withData<NativeImageRead>(CF_DIB, (size, copyBytes) => {
            const header = copyBytes(Math.min(size, MAX_DIB_HEADER_BYTES))
            const dimensions = dibDimensions(header, size)
            if (!dimensions) return { status: 'invalid' }
            if (exceedsImagePixelLimit(dimensions)) return { status: 'pixel-limit' }
            const length = dibSnapshotLength(header, size)
            if (!length) return { status: 'invalid' }
            // Keep an owned copy of the validated DIB before releasing the native locks.
            return { status: 'bitmap', bytes: copyBytes(length) }
          }) ?? { status: 'invalid' }
        }
        const jpeg = jpegFormats.find(candidate => candidate && has(candidate))
        if (jpeg) return readEncoded(jpeg, 'image/jpeg') ?? { status: 'invalid' }
        return { status: hasPng ? 'invalid' : 'empty' }
      })
    },
  }
}
