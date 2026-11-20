import koffi from 'koffi'
import type { QuickPickAction } from '../../shared/clipboard'

const WH_KEYBOARD_LL = 13
const LLKHF_INJECTED = 0x10
const LLKHF_ALTDOWN = 0x20
const LLKHF_UP = 0x80
const ERROR_INVALID_HOOK_HANDLE = 1404
const MODIFIERS = [0x10, 0x11, 0x12, 0x5b, 0x5c] // Shift, Ctrl, Alt, Win.
const ACTIONS: Readonly<Partial<Record<number, QuickPickAction>>> = {
  0x26: 'previous', 0x28: 'next', 0x0d: 'select', 0x1b: 'dismiss',
}
const keyboardProc = koffi.pointer(koffi.proto('intptr_t __stdcall QuickPickKeyboardProc(int code, uintptr_t message, const void *data)'))

export function createWindowsQuickPickKeys(
  isActive: () => boolean,
  onAction: (action: QuickPickAction) => void,
  testEventMarker?: number,
) {
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const install = user32.func('__stdcall', 'SetWindowsHookExW', 'uintptr_t', ['int', keyboardProc, 'uintptr_t', 'uint32_t'])
  const unhook = user32.func('int __stdcall UnhookWindowsHookEx(uintptr_t hook)')
  const next = user32.func('intptr_t __stdcall CallNextHookEx(uintptr_t hook, int code, uintptr_t message, const void *data)')
  const keyState = user32.func('int16_t __stdcall GetAsyncKeyState(int key)')
  const moduleHandle = kernel32.func('uintptr_t __stdcall GetModuleHandleW(const uint16_t *name)')
  const lastError = kernel32.func('uint32_t __stdcall GetLastError()')
  let disposed = false
  const consumed = new Set<number>()
  // Don't adopt a keystroke that started before opening the panel or with a modifier.
  const passed = new Set(Object.keys(ACTIONS).map(Number).filter(key => keyState(key) < 0))

  function dispatch(action: QuickPickAction) {
    // Stay out of the renderer and clipboard from the native input callback.
    setImmediate(() => {
      if (!disposed && isActive()) onAction(action)
    })
  }

  function consume(data: bigint): boolean {
    // KBDLLHOOKSTRUCT stores vkCode, flags and dwExtraInfo at offsets 0, 8 and 16.
    const key = koffi.decode.uint32(data)
    const action = ACTIONS[key]
    if (!action || !isActive()) return false
    const flags = koffi.decode(data, 8, 'uint32_t') as number
    if (flags & LLKHF_INJECTED) {
      if (testEventMarker === undefined || Number(koffi.decode(data, 16, 'uintptr_t')) !== testEventMarker) return false
    }
    const modified = !!(flags & LLKHF_ALTDOWN) || MODIFIERS.some(modifier => keyState(modifier) < 0)
    const directional = action === 'previous' || action === 'next'
    if (flags & LLKHF_UP) {
      passed.delete(key)
      if (!consumed.delete(key)) return false
      if (!directional && !modified) dispatch(action)
      return true
    }
    if (!consumed.has(key)) {
      if (modified || passed.has(key)) {
        passed.add(key)
        return false
      }
      consumed.add(key)
    }
    if (directional && !modified) dispatch(action)
    return true
  }

  const callback = koffi.register((code: number, message: number | bigint, data: bigint | null) => {
    if (!disposed && code === 0 && data) {
      try { if (consume(data)) return 1 }
      catch { /* Let the system deliver the keystroke if the panel cannot handle it. */ }
    }
    return next(0, code, message, data)
  }, keyboardProc)
  let hook: number | bigint
  try {
    hook = install(WH_KEYBOARD_LL, callback, moduleHandle(null), 0)
    if (!hook) throw new Error('Не удалось подключить клавиши быстрого выбора.')
  } catch (error) {
    koffi.unregister(callback)
    throw error
  }
  return {
    dispose() {
      if (disposed) return
      disposed = true
      // Never free a callback that Windows could still invoke. A timed-out hook
      // can already have been removed by Windows.
      if (unhook(hook) || lastError() === ERROR_INVALID_HOOK_HANDLE) koffi.unregister(callback)
    },
  }
}
