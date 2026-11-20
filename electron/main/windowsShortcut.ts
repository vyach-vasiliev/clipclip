import koffi from 'koffi'
import type { BrowserWindow } from 'electron'
import { DEFAULT_SHORTCUTS, parseShortcut } from '../../shared/shortcuts'

const WM_HOTKEY = 0x0312
const SHORTCUT_ID = 0x4343

export interface ShortcutReservation {
  commit(): void
  cancel(): void
}

export function createWindowsShortcut(window: BrowserWindow, invoke: () => void) {
  // Physical virtual keys keep the configured shortcut stable across input layouts.
  const user32 = koffi.load('user32.dll')
  const register = user32.func('int __stdcall RegisterHotKey(uintptr_t hwnd, int id, uint modifiers, uint key)')
  const unregister = user32.func('int __stdcall UnregisterHotKey(uintptr_t hwnd, int id)')
  const handle = window.getNativeWindowHandle()
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
  let activeId: number | null = null
  let reservedId: number | null = null
  let activeShortcut = ''
  let disposed = false
  window.hookWindowMessage(WM_HOTKEY, wParam => {
    const id = wParam.length === 8 ? Number(wParam.readBigUInt64LE()) : wParam.readUInt32LE()
    if (id === activeId) invoke()
  })
  function reserve(shortcut: string): ShortcutReservation | null {
    if (disposed || reservedId !== null) return null
    if (activeId !== null && shortcut === activeShortcut) return { commit() {}, cancel() {} }
    const parsed = parseShortcut(shortcut)
    if (!parsed) return null
    // Leave the old binding installed until the caller finishes its operation.
    const nextId = activeId === SHORTCUT_ID ? SHORTCUT_ID + 1 : SHORTCUT_ID
    if (!register(hwnd, nextId, parsed.windowsModifiers | 0x4000, parsed.virtualKey)) return null
    reservedId = nextId
    let settled = false
    return {
      commit() {
        if (settled || disposed) return
        settled = true
        if (activeId !== null) unregister(hwnd, activeId)
        activeId = nextId
        activeShortcut = shortcut
        reservedId = null
      },
      cancel() {
        if (settled || disposed) return
        settled = true
        unregister(hwnd, nextId)
        reservedId = null
      },
    }
  }
  return {
    reserve,
    set(shortcut: string = DEFAULT_SHORTCUTS.openWindow): boolean {
      const reservation = reserve(shortcut)
      if (!reservation) return false
      reservation.commit()
      return true
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (reservedId !== null) unregister(hwnd, reservedId)
      if (activeId !== null) unregister(hwnd, activeId)
      activeId = null
      reservedId = null
      if (!window.isDestroyed()) window.unhookWindowMessage(WM_HOTKEY)
    },
  }
}
