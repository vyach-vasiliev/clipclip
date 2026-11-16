export const DEFAULT_SHORTCUTS = {
  openWindow: 'Ctrl+Alt+B',
  copySelected: 'Enter',
  deleteSelected: 'Delete',
  previewSelected: 'Ctrl+Enter',
  toggleFavorite: 'Ctrl+D',
  togglePause: 'Ctrl+Shift+P',
  showFavorites: 'Ctrl+F',
  openSettings: 'Ctrl+,',
} as const
export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS
export type ShortcutSettings = Record<ShortcutAction, string>
export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  openWindow: 'Открыть ClipClip', copySelected: 'Копировать и скрыть',
  deleteSelected: 'Удалить выбранную запись', previewSelected: 'Просмотреть запись',
  toggleFavorite: 'Добавить или убрать из избранного', togglePause: 'Пауза или продолжение записи',
  showFavorites: 'Показать или скрыть избранное', openSettings: 'Открыть настройки',
}
const modifiers = ['Ctrl', 'Alt', 'Shift', 'Super']
const namedKeys: Record<string, number> = { Enter: 0x0d, Delete: 0x2e, Backspace: 0x08, Space: 0x20,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, ',': 0xbc }
export function parseShortcut(value: unknown): { key: string; modifiers: string[]; virtualKey: number; windowsModifiers: number } | null {
  if (typeof value !== 'string' || value.length > 80) return null
  const parts = value.split('+'), key = parts.pop()!
  if (parts.some((part, index) => !modifiers.includes(part) || parts.indexOf(part) !== index)
    || parts.join('+') !== modifiers.filter(modifier => parts.includes(modifier)).join('+')) return null
  const virtualKey = /^[A-Z0-9]$/.test(key) ? key.charCodeAt(0)
    : /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ? 0x70 + Number(key.slice(1)) - 1 : Object.hasOwn(namedKeys, key) ? namedKeys[key] : undefined
  if (virtualKey === undefined) return null
  return { key, modifiers: parts, virtualKey,
    windowsModifiers: (parts.includes('Alt') ? 1 : 0) | (parts.includes('Ctrl') ? 2 : 0)
      | (parts.includes('Shift') ? 4 : 0) | (parts.includes('Super') ? 8 : 0) }
}
export function shortcutError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Некорректные горячие клавиши.'
  const settings = value as ShortcutSettings
  const seen = new Set<string>()
  for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
    const shortcut = parseShortcut(settings[action])
    if (!shortcut) return 'Используйте буквы, цифры, F-клавиши, Enter, Delete, Space или запятую.'
    if (action === 'openWindow' && (!shortcut.modifiers.some(key => ['Ctrl', 'Alt', 'Super'].includes(key)) || shortcut.key === 'F12')) {
      return 'Для вызова окна добавьте Ctrl, Alt или Win / Command. F12 недоступна.'
    }
    if (action !== 'openWindow' && !shortcut.modifiers.some(key => ['Ctrl', 'Alt', 'Super'].includes(key))
      && !['Enter', 'Delete'].includes(shortcut.key) && !/^F\d+$/.test(shortcut.key)) {
      return 'Для букв и других клавиш добавьте Ctrl, Alt или Win / Command.'
    }
    if ((settings[action] === 'Ctrl+F' && action !== 'showFavorites') || (settings[action] === 'Ctrl+,' && action !== 'openSettings')
      || ['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y',
      'Super+C', 'Super+V', 'Super+X', 'Super+A', 'Super+Z', 'Alt+F4', 'Ctrl+Alt+Delete'].includes(settings[action])) {
      return 'Это сочетание используется для редактирования текста или управления окном.'
    }
    if (seen.has(settings[action])) return 'У разных действий должны быть разные сочетания.'
    seen.add(settings[action])
  }
  if (Object.keys(settings).some(key => !Object.hasOwn(DEFAULT_SHORTCUTS, key))) return 'Неизвестное действие горячей клавиши.'
  return null
}
export function restoreShortcuts(value: unknown): ShortcutSettings {
  const upgraded = upgradeShortcuts(value)
  return shortcutError(upgraded) ? { ...DEFAULT_SHORTCUTS } : { ...(upgraded as ShortcutSettings) }
}
export function upgradeShortcuts(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return { showFavorites: DEFAULT_SHORTCUTS.showFavorites, openSettings: DEFAULT_SHORTCUTS.openSettings, ...value }
}
export function shortcutFromEvent(event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
    : event.code === 'Comma' ? ',' : event.code === 'Space' || event.key === ' ' ? 'Space' : event.code || (/^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.key)
  const value = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+')
  return parseShortcut(value) ? value : null
}
export const shortcutLabel = (shortcut: string) => shortcut.replaceAll('+', ' + ').replace('Super', 'Win / ⌘')
