import koffi from 'koffi'
import type { BrowserWindow } from 'electron'

const WM_HOTKEY = 0x0312
const SHORTCUT_ID = 0x4343
const MOD_CONTROL_ALT_NOREPEAT = 0x4003
const VK_B = 0x42

export function registerWindowsShortcut(window: BrowserWindow, invoke: () => void): (() => void) | null {
  // A fixed Windows virtual key keeps B/И working across input-layout changes.
  const user32 = koffi.load('user32.dll')
  const register = user32.func('int __stdcall RegisterHotKey(uintptr_t hwnd, int id, uint modifiers, uint key)')
  const unregister = user32.func('int __stdcall UnregisterHotKey(uintptr_t hwnd, int id)')
  const handle = window.getNativeWindowHandle()
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
  if (!register(hwnd, SHORTCUT_ID, MOD_CONTROL_ALT_NOREPEAT, VK_B)) return null
  window.hookWindowMessage(WM_HOTKEY, wParam => {
    const id = wParam.length === 8 ? Number(wParam.readBigUInt64LE()) : wParam.readUInt32LE()
    if (id === SHORTCUT_ID) invoke()
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    unregister(hwnd, SHORTCUT_ID)
    if (!window.isDestroyed()) window.unhookWindowMessage(WM_HOTKEY)
  }
}
