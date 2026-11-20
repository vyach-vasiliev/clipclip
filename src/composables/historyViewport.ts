import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import type { ClipboardHistoryItem } from '../../shared/clipboard'
import { groupHistory } from '../utils/timestamps'

const GAP = 8
const DATE_HEADER_HEIGHT = 40
const OVERSCAN = 320
const DEFAULT_VIEWPORT_HEIGHT = 560
const MIN_VIRTUAL_ROWS = 80
const MAX_MEASURED_ROWS = 20_000

type HistoryGroup = ReturnType<typeof groupHistory>[number]

type RowLayout = {
  item: ClipboardHistoryItem
  group: number
  position: number
  top: number
  bottom: number
}

type VisibleGroup = {
  group: HistoryGroup
  before: number
  after: number
  rows: (RowLayout & { before: number })[]
}

function estimatedHeight(item: ClipboardHistoryItem) {
  if (item.type === 'image') return 89
  return Math.max(78, Math.min(144, (item.fileUris?.length ?? 0) * 40))
}

function firstAt(rows: RowLayout[], offset: number) {
  let start = 0
  let end = rows.length
  while (start < end) {
    const middle = (start + end) >>> 1
    if (rows[middle].bottom < offset) start = middle + 1
    else end = middle
  }
  return start
}

export function useHistoryViewport(groups: Readonly<Ref<HistoryGroup[]>>, viewport: Ref<HTMLElement | undefined>,
  selectedId: Readonly<Ref<string | null>>) {
  const focusedId = ref<string | null>(null)
  const focusedDateKey = ref<string | null>(null)
  const scroll = shallowRef({ top: 0, height: DEFAULT_VIEWPORT_HEIGHT })
  const measured = shallowRef(new Map<string, number>())
  const elements = new Map<string, HTMLElement>()
  let observer: ResizeObserver | undefined

  function updateViewport() {
    const top = viewport.value?.scrollTop ?? 0
    const height = viewport.value?.clientHeight || DEFAULT_VIEWPORT_HEIGHT
    if (scroll.value.top !== top || scroll.value.height !== height) scroll.value = { top, height }
  }

  function observeRow(id: string, element: Element | null) {
    const previous = elements.get(id)
    if (previous === element) return
    if (previous) observer?.unobserve(previous)
    if (element instanceof HTMLElement) {
      elements.set(id, element)
      observer?.observe(element)
    } else elements.delete(id)
  }

  function trackFocus(event: FocusEvent) {
    const target = event.type === 'focusout' ? event.relatedTarget : event.target
    const row = target instanceof Element ? target.closest<HTMLElement>('[data-history-row]') : null
    const date = target instanceof Element ? target.closest<HTMLElement>('[data-history-date-key]') : null
    focusedId.value = row && viewport.value?.contains(row) ? row.dataset.historyRow ?? null : null
    focusedDateKey.value = date && viewport.value?.contains(date) ? date.dataset.historyDateKey ?? null : null
  }

  watch(viewport, element => {
    observer?.disconnect()
    updateViewport()
    if (!element || typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(entries => {
      let next: Map<string, number> | undefined
      for (const entry of entries) {
        if (entry.target === viewport.value) { updateViewport(); continue }
        const row = entry.target as HTMLElement
        const id = row.dataset.historyRow
        const height = entry.borderBoxSize?.[0]?.blockSize ?? row.getBoundingClientRect().height
        if (!id || elements.get(id) !== row || !height) continue
        const index = layout.value.indices.get(id)
        if (index === undefined) continue
        const { top, bottom } = layout.value.rows[index]
        if (Math.abs(height - (bottom - top)) < 0.5) continue
        next ??= new Map(measured.value)
        if (next.size === MAX_MEASURED_ROWS && !next.has(id)) next.delete(next.keys().next().value!)
        next.set(id, height)
      }
      if (next) measured.value = next
    })
    observer.observe(element)
    elements.forEach(row => observer?.observe(row))
  }, { flush: 'post' })
  onBeforeUnmount(() => observer?.disconnect())

  const layout = computed(() => {
    let top = 0
    const rows: RowLayout[] = []
    const indices = new Map<string, number>()
    const dates = new Map<string, number>()
    const blocks = groups.value.map((group, index) => {
      const start = top
      if (!group.pinned) {
        dates.set(group.key, rows.length)
        top += DATE_HEADER_HEIGHT
      }
      for (const [position, item] of group.records.entries()) {
        const bottom = top + (measured.value.get(item.id) ?? estimatedHeight(item))
        indices.set(item.id, rows.length)
        rows.push({ item, group: index, position, top, bottom })
        top = bottom + GAP
      }
      return { top: start, bottom: top - GAP }
    })
    return { rows, indices, dates, blocks, height: Math.max(0, top - GAP) }
  })

  const displayed = computed(() => {
    const { rows, indices, dates, blocks, height } = layout.value
    const renderAll = rows.length <= MIN_VIRTUAL_ROWS
    const top = renderAll ? 0 : scroll.value.top
    const end = renderAll ? Infinity : top + scroll.value.height + OVERSCAN
    const start = renderAll ? 0 : firstAt(rows, top - OVERSCAN)
    const visible = new Set<number>()
    for (let index = start; index < rows.length && rows[index].top <= end; index++) visible.add(index)
    // Keep the active tab stop and focused controls connected across a pointer scroll.
    if (!renderAll) {
      for (const id of [selectedId.value, focusedId.value]) {
        const index = id ? indices.get(id) : undefined
        if (index !== undefined) visible.add(index)
      }
      const focusedDate = focusedDateKey.value ? dates.get(focusedDateKey.value) : undefined
      if (focusedDate !== undefined) visible.add(focusedDate)
    }
    const result: VisibleGroup[] = []
    let previousBlockBottom = 0
    let previousRowBottom = 0
    let previousGroup = -1
    for (const index of [...visible].sort((a, b) => a - b)) {
      const row = rows[index]
      const block = blocks[row.group]
      if (row.group !== previousGroup) {
        const group = groups.value[row.group]
        result.push({ group, before: block.top - previousBlockBottom, after: 0, rows: [] })
        previousBlockBottom = block.bottom
        previousRowBottom = block.top + (group.pinned ? 0 : DATE_HEADER_HEIGHT)
        previousGroup = row.group
      }
      const group = result[result.length - 1]
      group.rows.push({ ...row, before: row.top - previousRowBottom })
      previousRowBottom = row.bottom
      group.after = block.bottom - row.bottom
    }
    return { groups: result, after: height - previousBlockBottom }
  })

  return { displayed, observeRow, trackFocus, updateViewport }
}
