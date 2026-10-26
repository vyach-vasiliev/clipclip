import path from 'node:path'
import koffi from 'koffi'
import type { ClipboardSource } from '../../shared/clipboard'

export interface ClipboardOwnerApi {
  sequence(): number
  owner(): number | bigint
  processId(window: number | bigint): number
  processPath(processId: number): string | undefined
  title(window: number | bigint): string
}

interface OwnerCapture { sequence: number; source: ClipboardSource }

export function createClipboardOwnerReader(api: ClipboardOwnerApi, ownProcessId: number) {
  let cached: OwnerCapture | undefined
  return {
    capture(): OwnerCapture | undefined {
      try {
        const sequence = api.sequence()
        if (!sequence) return undefined
        if (cached?.sequence === sequence) return cached
        const window = api.owner()
        if (!window) return undefined
        const processId = api.processId(window)
        if (!processId || processId === ownProcessId) return undefined
        const executable = api.processPath(processId)
        if (!executable) return undefined
        const basename = path.win32.basename(executable).replace(/\.exe$/i, '')
        const name = /^(SnippingTool|ScreenClippingHost|ScreenSketch)$/i.test(basename) ? 'Ножницы' : basename
        if (!name) return undefined
        const source = { name: name.slice(0, 500), title: api.title(window).slice(0, 2000) }
        if (api.sequence() !== sequence) return undefined
        return cached = { sequence, source }
      } catch { return undefined }
    },
    resolve(capture: OwnerCapture | undefined): ClipboardSource | undefined {
      try { return capture && api.sequence() === capture.sequence ? capture.source : undefined }
      catch { return undefined }
    },
  }
}

export function createWindowsClipboardOwnerApi(): ClipboardOwnerApi {
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const sequence = user32.func('uint32_t __stdcall GetClipboardSequenceNumber()')
  const owner = user32.func('uintptr_t __stdcall GetClipboardOwner()')
  const windowProcess = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *processId)')
  const windowText = user32.func('int __stdcall GetWindowTextW(uintptr_t hwnd, _Out_ uint16_t *text, int count)')
  const open = kernel32.func('uintptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t processId)')
  const queryPath = kernel32.func('int __stdcall QueryFullProcessImageNameW(uintptr_t process, uint32_t flags, _Out_ uint16_t *path, _Inout_ uint32_t *size)')
  const close = kernel32.func('int __stdcall CloseHandle(uintptr_t handle)')
  return {
    sequence: () => sequence(),
    owner: () => owner(),
    processId(window) {
      const id = [0]
      return windowProcess(window, id) ? id[0] : 0
    },
    processPath(processId) {
      // Query only the executable name; no process-memory access or elevation.
      const handle = open(0x1000, 0, processId)
      if (!handle) return undefined
      try {
        const size = [32768]
        const buffer = Buffer.alloc(size[0] * 2)
        return queryPath(handle, 0, buffer, size) ? buffer.toString('utf16le', 0, size[0] * 2) : undefined
      } finally { close(handle) }
    },
    title(window) {
      const buffer = Buffer.alloc(2001 * 2)
      const length = windowText(window, buffer, 2001)
      return length > 0 ? buffer.toString('utf16le', 0, length * 2) : ''
    },
  }
}

let reader: ReturnType<typeof createClipboardOwnerReader> | undefined
let unavailable = false
export function getWindowsClipboardOwnerReader() {
  if (process.platform !== 'win32' || unavailable) return undefined
  try { return reader ??= createClipboardOwnerReader(createWindowsClipboardOwnerApi(), process.pid) }
  catch { unavailable = true; return undefined }
}
