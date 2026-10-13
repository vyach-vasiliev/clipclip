import { computed, onBeforeUnmount, ref, watch } from 'vue'

export function useImageZoom() {
  const viewport = ref<HTMLElement>()
  const natural = ref({ width: 0, height: 0 })
  const bounds = ref({ width: 0, height: 0 })
  const fit = ref(true)
  const manualScale = ref(1)
  const renderedScale = ref(1)
  const scale = computed(() => fit.value && natural.value.width && bounds.value.width && bounds.value.height
    ? Math.min(1, bounds.value.width / natural.value.width, bounds.value.height / natural.value.height) : manualScale.value)
  const percent = computed(() => Math.round(renderedScale.value * 100))
  const canvasStyle = computed(() => ({
    width: natural.value.width * renderedScale.value + 'px', height: natural.value.height * renderedScale.value + 'px',
  }))
  const imageStyle = computed(() => natural.value.width ? {
    width: natural.value.width + 'px', height: natural.value.height + 'px', maxWidth: 'none',
    transform: `scale(${renderedScale.value})`,
  } : { maxWidth: '100%' })
  let observer: ResizeObserver | undefined
  let animation: number | undefined
  let initializing = false
  let previousTime = 0
  let anchor: { x: number, y: number, imageX: number, imageY: number } | undefined
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  function stopAnimation() {
    if (animation !== undefined) cancelAnimationFrame(animation)
    animation = undefined
  }
  function frame(time: number) {
    const elapsed = Math.min(64, Math.max(1, time - previousTime))
    previousTime = time
    const difference = Math.log(scale.value / renderedScale.value)
    renderedScale.value = Math.abs(difference) < .0005 ? scale.value
      : renderedScale.value * Math.exp(difference * (1 - Math.exp(-elapsed / 45)))
    animation = renderedScale.value === scale.value ? undefined : requestAnimationFrame(frame)
  }
  watch(scale, value => {
    if (initializing || !natural.value.width || reducedMotion?.matches) {
      stopAnimation()
      renderedScale.value = value
    } else if (animation === undefined) {
      previousTime = performance.now()
      animation = requestAnimationFrame(frame)
    }
  }, { flush: 'sync' })
  // Keep the image point under the cursor stationary after the scrollable canvas resizes.
  watch(renderedScale, value => {
    const element = viewport.value
    if (!element || !anchor) return
    const width = natural.value.width * value
    const height = natural.value.height * value
    element.scrollLeft = anchor.imageX * width + Math.max(0, (element.clientWidth - width) / 2) - anchor.x
    element.scrollTop = anchor.imageY * height + Math.max(0, (element.clientHeight - height) / 2) - anchor.y
  }, { flush: 'post' })
  function setAnchor(clientX?: number, clientY?: number) {
    const element = viewport.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    const x = clientX === undefined ? element.clientWidth / 2 : clientX - rect.left - element.clientLeft
    const y = clientY === undefined ? element.clientHeight / 2 : clientY - rect.top - element.clientTop
    const width = natural.value.width * renderedScale.value
    const height = natural.value.height * renderedScale.value
    anchor = { x, y,
      imageX: Math.max(0, Math.min(1, (element.scrollLeft + x - Math.max(0, (element.clientWidth - width) / 2)) / width)),
      imageY: Math.max(0, Math.min(1, (element.scrollTop + y - Math.max(0, (element.clientHeight - height) / 2)) / height)),
    }
  }
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
    initializing = true
    natural.value = { width: image.naturalWidth, height: image.naturalHeight }
    measure()
    renderedScale.value = scale.value
    initializing = false
  }
  function setScale(value: number, clientX?: number, clientY?: number) {
    if (!natural.value.width || !Number.isFinite(value)) return
    setAnchor(clientX, clientY)
    manualScale.value = Math.max(.01, Math.min(8, value))
    fit.value = false
  }
  function zoom(direction: number) {
    if (direction < 0 && scale.value <= .01) return
    setScale(scale.value * (direction > 0 ? 1.2 : 1 / 1.2))
  }
  function wheel(event: WheelEvent) {
    if (!event.ctrlKey || !event.deltaY) return
    event.preventDefault()
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.value.height : 1)
    setScale(scale.value * Math.exp(-Math.max(-120, Math.min(120, pixels)) * .0015), event.clientX, event.clientY)
  }
  function fitImage() { anchor = undefined; fit.value = true; measure(); viewport.value?.scrollTo({ left: 0, top: 0 }) }
  function reset() {
    stopAnimation(); anchor = undefined; initializing = true
    natural.value = { width: 0, height: 0 }; manualScale.value = 1; fitImage(); renderedScale.value = scale.value
    initializing = false
  }
  onBeforeUnmount(() => { observer?.disconnect(); stopAnimation() })
  return { viewport, natural, scale, renderedScale, percent, imageStyle, canvasStyle, loaded, loadImage, zoom, wheel, setScale, fitImage, reset }
}
