import { describe, expect, it } from 'vitest'
import { classifyText, matchesTag } from '../shared/content'
import { isFileUriList, isHistoryItem, KIND_LABELS, type ClipboardKind } from '../shared/clipboard'
const source = { name: 'Browser', title: '' }
describe('clipboard classification and multilingual tags', () => {
  it.each(['#bdbde9', 'rgb(189, 189, 233)', 'oklch(70% .1 240)', 'color(srgb .84 .84 .84)'])('tags %s as a color even from a document app', text => {
    expect(classifyText(text, { name: 'Microsoft Word', title: 'document.docx' })).toBe('color')
  })
  it.each(['https://example.test/file.pdf', 'http://example.test/path?q=1', 'www.example.test', 'mailto:test@example.test'])('recognizes the single address %s as a link', text => {
    expect(classifyText(text, { name: 'Microsoft Word', title: '' })).toBe('link')
  })
  it.each(['see https://example.test', 'javascript:alert(1)', 'hello\nhttps://example.test'])('preserves ordinary text %s', text => {
    expect(classifyText(text, source)).toBe('text')
  })
  it.each(['C:\\Docs\\Report.PDF', 'Annual report.xlsx', 'notes.docx', 'macros.docm', 'table.xlsb', 'slides.pptm', 'file:///C:/Docs/Report%20one.odt'])('detects the document extension of %s', text => {
    expect(classifyText(text, source)).toBe('document')
  })
  it.each(['Microsoft Word', 'WINWORD.EXE', 'Microsoft Excel', 'LibreOffice Writer', 'Acrobat Reader', 'PowerPoint'])('recognizes text from %s', name => {
    expect(classifyText('document paragraph', { name, title: '' })).toBe('document')
  })
  it('uses a document title without treating unrelated word fragments as an app', () => {
    expect(classifyText('paragraph', { name: 'Browser', title: 'Annual report.pdf — Browser' })).toBe('document')
    expect(classifyText('paragraph', { name: 'Password manager', title: '' })).toBe('text')
  })
  it.each([
    ['text', ['text', 'txt', 'текст']], ['image', ['image', 'img', 'pic', 'picture', 'photo', 'изображение']],
    ['document', ['document', 'doc', 'документ']], ['link', ['link', 'url', 'hyperlink', 'ссылка']],
    ['file', ['file', 'folder', 'directory', 'файл', 'папка']],
    ['color', ['color', 'colour', 'цвет', 'hex', 'rgb']],
  ] as [ClipboardKind, string[]][])('matches Russian and English aliases for %s', (kind, aliases) => {
    for (const alias of aliases) expect(matchesTag({ code: 'type', value: KIND_LABELS[kind] }, '#' + alias)).toBe(true)
    expect(matchesTag({ code: 'source', value: KIND_LABELS[kind] }, '#url')).toBe(false)
  })
  it('distinguishes length from image dimensions in English', () => {
    expect(matchesTag({ code: 'size', value: '20 симв.' }, 'length')).toBe(true)
    expect(matchesTag({ code: 'size', value: '20 симв.' }, 'chars')).toBe(true)
    expect(matchesTag({ code: 'size', value: '400 × 240' }, 'dimensions')).toBe(true)
    expect(matchesTag({ code: 'size', value: '400 × 240' }, 'length')).toBe(false)
  })
  it('accepts only bounded file URI lists without malformed paths or remote URL schemes', () => {
    expect(isFileUriList(['file:///C:/Docs/Report%20one.pdf', 'file://server/share/report.xlsx'])).toBe(true)
    for (const value of [[], ['https://example.test/a.pdf'], ['file:///C:/a%00.pdf'], ['file:///C:/a%ZZ.pdf'], ['file:///a.pdf#x'], Array(101).fill('file:///a.pdf')]) expect(isFileUriList(value)).toBe(false)
  })
  it('restores document metadata only on a document record and rejects injected remote file lists', () => {
    const record = { id: 'fixture', type: 'document', data: 'C:/Docs/a.pdf', fileUris: ['file:///C:/Docs/a.pdf'], createdAt: 1,
      params: { type: 'document', size: '1 файл.', source, tags: [{ code: 'type', value: 'Документ' }] } }
    expect(isHistoryItem(record)).toBe(true)
    expect(isHistoryItem({ ...record, type: 'file', params: { ...record.params, type: 'file' } })).toBe(true)
    expect(isHistoryItem({ ...record, type: 'file', fileUris: undefined, params: { ...record.params, type: 'file' } })).toBe(false)
    expect(isHistoryItem({ ...record, type: 'link', params: { ...record.params, type: 'link' } })).toBe(false)
    expect(isHistoryItem({ ...record, fileUris: ['https://example.test/a.pdf'] })).toBe(false)
    expect(isHistoryItem({ ...record, fileKinds: ['folder'] })).toBe(true)
    expect(isHistoryItem({ ...record, fileKinds: ['folder', 'file'] })).toBe(false)
    expect(isHistoryItem({ ...record, fileKinds: ['injected'] })).toBe(false)
  })
})
