import path from 'node:path'

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
