import { onBeforeUnmount, onMounted, ref, watch, type CSSProperties, type Ref } from 'vue'
import type { ClipboardHistoryItem } from '../../shared/clipboard'

export const IMAGE_HOVER_DELAY = 500

export function useImageHoverPreview(items: Ref<ClipboardHistoryItem[]>, enabled: Ref<boolean>) {
  const preview = ref<ClipboardHistoryItem | null>(null)
  const style = ref<CSSProperties>({})
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel() {
    clearTimeout(timer)
    timer = undefined
    preview.value = null
  }
  function schedule(item: ClipboardHistoryItem, event: MouseEvent) {
    cancel()
    if (!enabled.value || item.type !== 'image') return
    const thumbnail = event.currentTarget as HTMLImageElement
    timer = setTimeout(() => {
      timer = undefined
      if (!enabled.value || !thumbnail.isConnected || document.querySelector('dialog[open]')) return
      const bounds = thumbnail.getBoundingClientRect()
      const margin = 14, gap = 8, frame = 10
      const width = Math.max(1, window.innerWidth - margin * 2 - frame)
      const ratio = thumbnail.naturalWidth > 0 ? thumbnail.naturalHeight / thumbnail.naturalWidth : bounds.height / Math.max(1, bounds.width)
      const desiredHeight = Math.min(width * ratio + frame, window.innerHeight * .7)
      const above = Math.max(0, bounds.top - margin - gap)
      const below = Math.max(0, window.innerHeight - margin - bounds.bottom - gap)
      const placeBelow = below >= desiredHeight || below >= above
      const height = Math.min(desiredHeight, placeBelow ? below : above)
      if (height <= frame) return
      const top = placeBelow ? bounds.bottom + gap : bounds.top - gap - height
      style.value = { top: `${top}px`, height: `${height}px` }
      preview.value = item
    }, IMAGE_HOVER_DELAY)
  }
  watch([items, enabled], cancel, { flush: 'sync' })
  onMounted(() => {
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    document.addEventListener('pointerdown', cancel, true)
    document.addEventListener('keydown', cancel, true)
  })
  onBeforeUnmount(() => {
    cancel()
    window.removeEventListener('blur', cancel)
    window.removeEventListener('resize', cancel)
    document.removeEventListener('pointerdown', cancel, true)
    document.removeEventListener('keydown', cancel, true)
  })
  return { preview, style, schedule, cancel }
}
