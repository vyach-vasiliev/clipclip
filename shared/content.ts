import { KIND_LABELS, TAG_LABELS, type ClipboardKind, type ClipboardSource, type ClipboardTag } from './clipboard'
import { parseColor } from './colors'

const documentExtension = /\.(?:pdf|doc[xm]?|dot[xm]?|xls[xmb]?|xlt[xm]?|ppt[xm]?|pps[xm]?|pot[xm]?|odt|ods|odp|rtf|txt|md|csv|tsv|epub|fb2|djvu?|pages|numbers|key)(?=$|\s+[-—|])/i
const documentApp = /(?:^|[\s._-])(?:winword|word|excel|powerpnt|powerpoint|onenote|libreoffice|soffice|openoffice|wps|acrobat|acrord32|foxit|sumatrapdf|pages|numbers|keynote)(?:$|[\s._-])/i
export function isDocumentFile(value: string): boolean {
  try { if (value.startsWith('file:')) value = decodeURIComponent(new URL(value).pathname) } catch { return false }
  return documentExtension.test(value)
}
export function classifyText(text: string, source: ClipboardSource): Exclude<ClipboardKind, 'image' | 'file'> {
  const value = text.trim()
  if (parseColor(text)) return 'color'
  if (value && !/\s/.test(value)) {
    try {
      const url = new URL(/^www\./i.test(value) ? 'https://' + value : value)
      if (['http:', 'https:', 'ftp:'].includes(url.protocol) && url.hostname || ['mailto:', 'tel:'].includes(url.protocol) && url.pathname) return 'link'
    } catch { /* An ordinary text fragment is not a URL. */ }
  }
  if (documentApp.test(source.name) || isDocumentFile(source.title)
    || (!/[\r\n]/.test(value) && value.length <= 32768 && isDocumentFile(value))) return 'document'
  return 'text'
}

const typeAliases: Record<ClipboardKind, string[]> = {
  color: ['color', 'colour', 'цвет', 'hex', 'rgb', 'hsl', 'oklch'],
  text: ['text', 'txt', 'plain text', 'текст'],
  image: ['image', 'img', 'pic', 'picture', 'photo', 'изображение', 'картинка', 'фото'],
  document: ['document', 'doc', 'pdf', 'word', 'excel', 'документ'],
  file: ['file', 'files', 'folder', 'folders', 'directory', 'файл', 'файлы', 'папка', 'папки', 'каталог'],
  link: ['link', 'url', 'uri', 'hyperlink', 'ссылка', 'адрес'],
}
export function tagKind(tag: ClipboardTag): ClipboardKind | undefined {
  if (tag.code !== 'type') return undefined
  const value = tag.value.toLocaleLowerCase()
  return (Object.keys(typeAliases) as ClipboardKind[]).find(kind => KIND_LABELS[kind].toLocaleLowerCase() === value || typeAliases[kind].includes(value))
}
export function matchesTag(tag: ClipboardTag, query: string, includeCategory = true): boolean {
  const text = query.trim().toLocaleLowerCase().replace(/^#/, '').trim()
  if (!text || tag.value.toLocaleLowerCase().includes(text)) return true
  const kind = tagKind(tag)
  if (kind && typeAliases[kind].some(alias => alias.includes(text))) return true
  if (tag.code === 'size') {
    const aliases = tag.value.includes('симв') ? ['length', 'len', 'char', 'chars', 'characters', 'длина', 'символы']
      : ['size', 'dimensions', 'resolution', 'width', 'height', 'размер', 'ширина', 'высота']
    if (aliases.some(alias => alias.includes(text))) return true
  }
  return includeCategory && (tag.code.includes(text) || TAG_LABELS[tag.code].toLocaleLowerCase().includes(text))
}
