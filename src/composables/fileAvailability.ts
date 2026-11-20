import { computed, ref, watch, type Ref } from 'vue'
import type { ClipboardHistoryItem, FileCheckResult } from '../../shared/clipboard'

export function useFileAvailability(items: Ref<ClipboardHistoryItem[]>) {
  const checks = ref<Record<string, { list?: FileCheckResult; paths: Record<number, FileCheckResult> }>>(Object.create(null))
  const states = computed(() => {
    const failures: Record<string, FileCheckResult> = Object.create(null)
    for (const [id, result] of Object.entries(checks.value)) {
      const failure = result.list ?? Object.values(result.paths)[0]
      if (failure) failures[id] = failure
    }
    return failures
  })

  function update(id: string, result: FileCheckResult, index?: number) {
    if (!items.value.some(item => item.id === id && item.fileUris)) return
    if (index === undefined) {
      if (result.status === 'available') delete checks.value[id]
      else checks.value[id] = { list: result, paths: {} }
      return
    }
    if (result.status !== 'available') (checks.value[id] ??= { paths: {} }).paths[index] = result
    else if (checks.value[id]) delete checks.value[id].paths[index]
  }

  watch(items, current => {
    const ids = new Set(current.filter(item => item.fileUris).map(item => item.id))
    for (const id of Object.keys(checks.value)) {
      if (!ids.has(id)) delete checks.value[id]
    }
  })

  return { states, update }
}
