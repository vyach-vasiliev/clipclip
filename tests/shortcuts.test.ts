import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS, parseShortcut, restoreShortcuts, shortcutError, shortcutFromEvent } from '../shared/shortcuts'

describe('shortcut settings', () => {
  it('restores legacy or corrupt settings without affecting the defaults', () => {
    expect(restoreShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS)
    expect(restoreShortcuts({ ...DEFAULT_SHORTCUTS, openWindow: 'invalid' })).toEqual(DEFAULT_SHORTCUTS)
    const restored = restoreShortcuts({ ...DEFAULT_SHORTCUTS, openWindow: 'Ctrl+Shift+Q' })
    expect(restored.openWindow).toBe('Ctrl+Shift+Q')
    restored.copySelected = 'F8'
    expect(DEFAULT_SHORTCUTS.copySelected).toBe('Enter')
  })
  it('rejects malformed, duplicate and reserved shortcuts', () => {
    expect(shortcutError(DEFAULT_SHORTCUTS)).toBeNull()
    for (const value of [null, [], {}, { ...DEFAULT_SHORTCUTS, openWindow: 'B' },
      { ...DEFAULT_SHORTCUTS, copySelected: 'Ctrl+D' }, { ...DEFAULT_SHORTCUTS, copySelected: 'Ctrl+V' },
      { ...DEFAULT_SHORTCUTS, openWindow: 'Ctrl+F12' }, { ...DEFAULT_SHORTCUTS, togglePause: 'P' },
      { ...DEFAULT_SHORTCUTS, togglePause: 'Shift+Ctrl+P' }, { ...DEFAULT_SHORTCUTS, extra: 'F9' }]) {
      expect(shortcutError(value)).toBeTypeOf('string')
    }
    expect(shortcutError({ ...DEFAULT_SHORTCUTS, copySelected: 'Shift+Enter' })).toBeNull()
  })
  it('uses physical key codes on Russian and English layouts', () => {
    const event = { key: 'и', code: 'KeyB', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }
    expect(shortcutFromEvent(event)).toBe('Ctrl+Alt+B')
    expect(shortcutFromEvent({ ...event, key: 'b' })).toBe('Ctrl+Alt+B')
    expect(shortcutFromEvent({ ...event, key: 'Shift', code: 'ShiftLeft' })).toBeNull()
    expect(parseShortcut('Ctrl+Alt+B')).toMatchObject({ virtualKey: 0x42, windowsModifiers: 3 })
    expect(parseShortcut('Ctrl+Shift+F10')).toMatchObject({ virtualKey: 0x79, windowsModifiers: 6 })
    expect(parseShortcut('Ctrl+constructor')).toBeNull()
    expect(parseShortcut('Ctrl+__proto__')).toBeNull()
  })
})
