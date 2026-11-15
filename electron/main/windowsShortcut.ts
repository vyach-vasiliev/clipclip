import koffi from 'koffi'
import type { BrowserWindow } from 'electron'
import { DEFAULT_SHORTCUTS, parseShortcut } from '../../shared/shortcuts'

const WM_HOTKEY = 0x0312
const SHORTCUT_ID = 0x4343
export function createWindowsShortcut(window: BrowserWindow, invoke: () => void) {
  // Physical virtual keys keep the configured shortcut stable across input layouts.
  const user32 = koffi.load('user32.dll')
  const register = user32.func('int __stdcall RegisterHotKey(uintptr_t hwnd, int id, uint modifiers, uint key)')
  const unregister = user32.func('int __stdcall UnregisterHotKey(uintptr_t hwnd, int id)')
  const handle = window.getNativeWindowHandle()
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
  let activeId: number | null = null
  let activeShortcut = ''
  let disposed = false
  window.hookWindowMessage(WM_HOTKEY, wParam => {
    const id = wParam.length === 8 ? Number(wParam.readBigUInt64LE()) : wParam.readUInt32LE()
    if (id === activeId) invoke()
  })
  return {
    set(shortcut: string = DEFAULT_SHORTCUTS.openWindow): boolean {
      if (disposed) return false
      if (activeId !== null && shortcut === activeShortcut) return true
      const parsed = parseShortcut(shortcut)
      if (!parsed) return false
      // Register under a second ID first, so a conflict leaves the old binding intact.
      const nextId = activeId === SHORTCUT_ID ? SHORTCUT_ID + 1 : SHORTCUT_ID
      if (!register(hwnd, nextId, parsed.windowsModifiers | 0x4000, parsed.virtualKey)) return false
      if (activeId !== null) unregister(hwnd, activeId)
      activeId = nextId
      activeShortcut = shortcut
      return true
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (activeId !== null) unregister(hwnd, activeId)
      activeId = null
      if (!window.isDestroyed()) window.unhookWindowMessage(WM_HOTKEY)
    },
  }
}
