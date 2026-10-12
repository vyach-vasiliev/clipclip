import type { ClipboardHistoryItem, ClipboardTag } from '../../shared/clipboard'
import { tagKey, TAG_LABELS } from '../../shared/clipboard'

export interface HighlightPart { text: string; matched: boolean }

export function highlightParts(text: string, query: string): HighlightPart[] {
  query = query.trim()
  if (!query) return [{ text, matched: false }]
  const special = '\\^$.*+?()[]{}|'
  const pattern = Array.from(query).map(character => special.includes(character) ? '\\' + character : character).join('')
  const matches = text.matchAll(new RegExp(pattern, 'giu'))
  const parts: HighlightPart[] = []
  let offset = 0
  for (const match of matches) {
    const start = match.index!
    if (start > offset) parts.push({ text: text.slice(offset, start), matched: false })
    parts.push({ text: match[0], matched: true })
    offset = start + match[0].length
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), matched: false })
  return parts.length ? parts : [{ text, matched: false }]
}

export function historyTags(items: ClipboardHistoryItem[]): ClipboardTag[] {
  const tags = new Map<string, ClipboardTag>()
  items.forEach(item => item.params.tags.forEach(tag => tags.set(tagKey(tag), tag)))
  return Array.from(tags.values())
}

export function filterHistory(items: ClipboardHistoryItem[], query: string, tags: ClipboardTag[]) {
  query = query.trim().toLocaleLowerCase()
  return items.filter(item => {
    const tagQuery = query.startsWith('#') ? query.slice(1) : query
    const matchesTag = item.params.tags.some(tag => tag.value.toLocaleLowerCase().includes(tagQuery)
      || (query.startsWith('#') && (tag.code.includes(tagQuery) || TAG_LABELS[tag.code].toLocaleLowerCase().includes(tagQuery))))
    const matchesQuery = !query || (!query.startsWith('#') && item.type === 'text' && item.data.toLocaleLowerCase().includes(query)) || matchesTag
    return matchesQuery && tags.every(selected => item.params.tags.some(tag => tagKey(tag) === tagKey(selected)))
  })
}

export function adjacentId(ids: string[], selectedId: string | null, direction: number): string | null {
  if (!ids.length) return null
  const index = selectedId ? ids.indexOf(selectedId) : -1
  if (index < 0) return direction < 0 ? ids.at(-1)! : ids[0]
  return ids[(index + direction + ids.length) % ids.length]
}

export function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (!!target.closest('input, textarea, select') || target.isContentEditable)
}

export function isActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('button:not(.record-select), a, summary, [role="button"]')
}
