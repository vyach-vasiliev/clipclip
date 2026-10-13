import { computed, onBeforeUnmount, ref, watch } from 'vue'

export function useImageZoom() {
  const viewport = ref<HTMLElement>()
  const natural = ref({ width: 0, height: 0 })
  const bounds = ref({ width: 0, height: 0 })
  const fit = ref(true)
  const manualScale = ref(1)
  const scale = computed(() => fit.value && natural.value.width && bounds.value.width && bounds.value.height
    ? Math.min(1, bounds.value.width / natural.value.width, bounds.value.height / natural.value.height) : manualScale.value)
  const percent = computed(() => Math.round(scale.value * 100))
  const imageStyle = computed(() => natural.value.width ? {
    width: natural.value.width * scale.value + 'px', height: natural.value.height * scale.value + 'px', maxWidth: 'none',
  } : { maxWidth: '100%' })
  let observer: ResizeObserver | undefined
  function measure() {
    bounds.value = { width: viewport.value?.clientWidth ?? 0, height: viewport.value?.clientHeight ?? 0 }
  }
  watch(viewport, element => {
    observer?.disconnect()
    if (!element) return
    measure()
    observer = new ResizeObserver(measure)
    observer.observe(element)
  }, { flush: 'post' })
  function loaded(event: Event) {
    loadImage(event.target as HTMLImageElement)
  }
  function loadImage(image: HTMLImageElement) {
    natural.value = { width: image.naturalWidth, height: image.naturalHeight }
    measure()
  }
  function setScale(value: number) {
    if (!natural.value.width) return
    manualScale.value = Math.max(.01, Math.min(8, value))
    fit.value = false
  }
  function zoom(direction: number) {
    if (direction < 0 && scale.value <= .01) return
    setScale(scale.value * (direction > 0 ? 1.25 : .8))
  }
  function wheel(event: WheelEvent) {
    if (!event.ctrlKey || !event.deltaY) return
    event.preventDefault()
    zoom(event.deltaY < 0 ? 1 : -1)
  }
  function fitImage() { fit.value = true; measure(); viewport.value?.scrollTo({ left: 0, top: 0 }) }
  function reset() { natural.value = { width: 0, height: 0 }; manualScale.value = 1; fitImage() }
  onBeforeUnmount(() => observer?.disconnect())
  return { viewport, natural, scale, percent, imageStyle, loaded, loadImage, zoom, wheel, setScale, fitImage, reset }
}
