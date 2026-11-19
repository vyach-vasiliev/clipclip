import koffi from 'koffi'
import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserWindow } from 'electron'

type Target = { hwnd: bigint; pid: number }
const WM_ACTIVATE = 0x0006
const PASTE_BLOCKING_KEYS = [0x01, 0x0d, 0x10, 0x11, 0x12, 0x5b, 0x5c]
const FOCUS_ERROR = 'Не удалось вернуть фокус в прежнее окно.'

export class PasteError extends Error {}

export interface PasteApi {
  foreground(): bigint
  processId(hwnd: bigint): number
  usable(hwnd: bigint): boolean
  activate(hwnd: bigint): void
  keyDown(key: number): boolean
  sendPaste(): boolean
}

// Keep the last external window even when ClipClip is opened from the taskbar.
export function createPasteController(api: PasteApi, ownPid = process.pid) {
  let target: Target | null = null
  function capture(hwnd = api.foreground()) {
    const pid = hwnd ? api.processId(hwnd) : 0
    if (pid && pid !== ownPid && api.usable(hwnd)) target = { hwnd, pid }
  }
  function valid(value: Target) {
    return api.usable(value.hwnd) && api.processId(value.hwnd) === value.pid
  }
  function checkTarget(value: Target, current: () => boolean) {
    if (!current()) throw new PasteError('Вставка отменена.')
    if (!valid(value)) throw new PasteError('Окно для вставки недоступно.')
  }
  return {
    capture,
    target: () => target && valid(target) ? { ...target } : null,
    async paste(value: Target, picker: bigint, current: () => boolean) {
      // Keep Enter and its repeats in the picker until the user releases it.
      for (let attempt = 0; attempt < 50; attempt++) {
        checkTarget(value, current)
        if (api.foreground() !== picker) throw new PasteError(FOCUS_ERROR)
        if (!PASTE_BLOCKING_KEYS.some(key => api.keyDown(key))) break
        if (attempt === 49) throw new PasteError('Отпустите клавиши и повторите вставку.')
        await delay(20)
      }
      // Windows can grant activation while the picker still owns the foreground.
      // Cross-process activation can take another turn of the target's message loop.
      api.activate(value.hwnd)
      let restored = false
      for (let attempt = 0; attempt < 50; attempt++) {
        checkTarget(value, current)
        const foreground = api.foreground()
        if (foreground === value.hwnd) {
          restored = true
          if (!PASTE_BLOCKING_KEYS.some(key => api.keyDown(key))) {
            if (api.foreground() !== value.hwnd) break
            if (!api.sendPaste()) throw new PasteError('Windows не разрешила автоматическую вставку.')
            return
          }
        } else if (restored || (foreground && foreground !== picker)) {
          break
        }
        await delay(20)
      }
      throw new PasteError(FOCUS_ERROR)
    },
  }
}

export function createWindowsPasteApi(): PasteApi {
  const user32 = koffi.load('user32.dll')
  const foreground = user32.func('uintptr_t __stdcall GetForegroundWindow()')
  const getPid = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)')
  const isWindow = user32.func('int __stdcall IsWindow(uintptr_t hwnd)')
  const isVisible = user32.func('int __stdcall IsWindowVisible(uintptr_t hwnd)')
  const getClass = user32.func('int __stdcall GetClassNameW(uintptr_t hwnd, void *name, int length)')
  const activate = user32.func('int __stdcall SetForegroundWindow(uintptr_t hwnd)')
  const keyState = user32.func('int16_t __stdcall GetAsyncKeyState(int key)')
  const sendInput = user32.func('uint __stdcall SendInput(uint count, const void *inputs, int size)')
  return {
    foreground: () => BigInt(foreground()),
    processId: hwnd => { const pid = [0]; getPid(hwnd, pid); return pid[0] },
    usable: hwnd => {
      if (!isWindow(hwnd) || !isVisible(hwnd)) return false
      const name = Buffer.alloc(512)
      getClass(hwnd, name, 256)
      return !['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', 'NotifyIconOverflowWindow'].includes(name.toString('utf16le').split('\0')[0])
    },
    activate: hwnd => { activate(hwnd) },
    keyDown: key => keyState(key) < 0,
    sendPaste: () => {
      // INPUT includes a pointer-aligned union whose largest member is MOUSEINPUT.
      const size = process.arch === 'ia32' ? 28 : 40
      const offset = process.arch === 'ia32' ? 4 : 8
      const inputs = Buffer.alloc(size * 4)
      // Physical scan codes preserve Ctrl+V across English and Russian layouts.
      ;[[0x1d, 8], [0x2f, 8], [0x2f, 10], [0x1d, 10]].forEach(([scan, flags], index) => {
        inputs.writeUInt32LE(1, index * size)
        inputs.writeUInt16LE(scan, index * size + offset + 2)
        inputs.writeUInt32LE(flags, index * size + offset + 4)
      })
      return sendInput(4, inputs, size) === 4
    },
  }
}

export function createWindowsPaste() {
  const controller = createPasteController(createWindowsPasteApi())
  controller.capture()
  const timer = setInterval(controller.capture, 100)
  timer.unref()
  return {
    ...controller,
    trackWindow(window: BrowserWindow) {
      window.hookWindowMessage(WM_ACTIVATE, (wParam, lParam) => {
        // Windows supplies the previous HWND when the picker is activated directly.
        if (wParam.readUInt16LE() !== 0 && lParam.length) controller.capture(readWindowHandle(lParam))
      })
    },
    dispose: () => clearInterval(timer),
  }
}

export function readWindowHandle(handle: Buffer): bigint {
  return handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
}
