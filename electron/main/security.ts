import path from 'node:path'
import { MAX_ITEM_BYTES } from '../../shared/clipboard'

export function isTrustedPage(candidate: string, entry: string): boolean {
  try {
    const url = new URL(candidate)
    const trusted = new URL(entry)
    return url.protocol === trusted.protocol && url.host === trusted.host
      && url.pathname === trusted.pathname && url.search === trusted.search
      && !url.username && !url.password
  } catch { return false }
}

export function assetPath(url: string, root: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'app:' || parsed.hostname !== 'clipclip') return null
    const pathname = decodeURIComponent(parsed.pathname)
    if (pathname.includes('\\') || pathname.includes('\0')) return null
    const resolved = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    const relative = path.relative(root, resolved)
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null
  } catch { return null }
}

export function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 100) throw new Error('Некорректный идентификатор записи.')
  return value
}

export function requireTextRevision(value: unknown): { id: string | null; text: string } {
  if (!value || typeof value !== 'object') throw new Error('Некорректная версия текста.')
  const revision = value as { id?: unknown; text?: unknown }
  const id = revision.id === null ? null : requireId(revision.id)
  if (typeof revision.text !== 'string' || Buffer.byteLength(revision.text, 'utf8') > MAX_ITEM_BYTES) {
    throw new Error('Текст должен быть не больше 8 МБ.')
  }
  return { id, text: revision.text }
}
