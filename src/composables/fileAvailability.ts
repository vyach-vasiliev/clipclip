import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { ClipboardHistoryItem, FileCheckResult } from '../../shared/clipboard'

interface FileState {
  status: FileCheckResult['status'] | 'checking'
  message: string
  checkedAt: number
}
const CACHE_MS = 5000

export function useFileAvailability(items: Ref<ClipboardHistoryItem[]>, list: Ref<HTMLElement | undefined>) {
  const states = ref<Record<string, FileState>>({})
  const visible = new Set<string>()
  const queued = new Set<string>()
  const versions = new Map<string, number>()
  let observer: IntersectionObserver | undefined
  let running = false
  let disposed = false

  function update(id: string, result: FileCheckResult) {
    if (!disposed) {
      versions.set(id, (versions.get(id) ?? 0) + 1)
      states.value[id] = { ...result, checkedAt: Date.now() }
    }
  }

  async function drain() {
    if (running || disposed) return
    running = true
    try {
      for (const id of queued) {
        queued.delete(id)
        const item = items.value.find(item => item.id === id && item.fileUris)
        if (!visible.has(id) || !item || !window.electronAPI) continue
        const cached = states.value[id]
        if (cached && Date.now() - cached.checkedAt < CACHE_MS) continue
        const version = versions.get(id) ?? 0
        if (!cached) states.value[id] = { status: 'checking', message: 'Проверка файлов…', checkedAt: 0 }
        let result: FileCheckResult
        try { result = await window.electronAPI.checkFiles(id) }
        catch { result = { status: 'unavailable', message: 'Не удалось проверить файлы и папки.' } }
        if (disposed) break
        if (items.value.some(current => current.id === id && current.fileUris)) {
          // A manual copy may have performed a newer check while this one ran.
          if ((versions.get(id) ?? 0) === version) update(id, result)
        } else delete states.value[id]
      }
    } finally { running = false }
  }

  function refresh() {
    visible.forEach(id => queued.add(id))
    void drain()
  }

  function observe() {
    observer?.disconnect()
    visible.clear()
    queued.clear()
    const ids = new Set(items.value.filter(item => item.fileUris).map(item => item.id))
    Object.keys(states.value).forEach(id => { if (!ids.has(id)) delete states.value[id] })
    for (const id of versions.keys()) { if (!ids.has(id)) versions.delete(id) }
    if (!list.value || typeof IntersectionObserver === 'undefined') return
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.fileId!
        if (entry.isIntersecting) { visible.add(id); queued.add(id) }
        else { visible.delete(id); queued.delete(id) }
      }
      void drain()
    }, { root: list.value })
    list.value.querySelectorAll<HTMLElement>('[data-file-id]').forEach(element => observer!.observe(element))
  }

  watch([items, list], observe, { flush: 'post' })
  onMounted(() => { observe(); window.addEventListener('focus', refresh) })
  onBeforeUnmount(() => {
    disposed = true
    queued.clear()
    observer?.disconnect()
    window.removeEventListener('focus', refresh)
  })
  return { states, refresh, update }
}
