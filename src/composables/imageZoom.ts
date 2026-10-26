import { computed, onBeforeUnmount, ref, watch } from 'vue'

export function useImageZoom() {
  const viewport = ref<HTMLElement>()
  const natural = ref({ width: 0, height: 0 })
  const bounds = ref({ width: 0, height: 0 })
  const fit = ref(true)
  const manualScale = ref(1)
  const renderedScale = ref(1)
  const dragging = ref(false)
  const canPan = computed(() => natural.value.width * renderedScale.value > bounds.value.width + 1
    || natural.value.height * renderedScale.value > bounds.value.height + 1)
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
  let animationStart = 0
  let animationFrom = 1
  let precisionInput = false
  let precisionAnimation = false
  let previousFrameTime = 0
  let lastPrecisionTime = -Infinity
  let precisionDirection = 0
  let drag: { element: HTMLElement, pointerId: number, x: number, y: number, left: number, top: number } | undefined
  let anchor: { x: number, y: number, imageX: number, imageY: number } | undefined
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  function stopAnimation() {
    if (animation !== undefined) cancelAnimationFrame(animation)
    animation = undefined
  }
  function frame(time: number) {
    if (precisionAnimation) {
      const elapsed = Math.max(0, time - previousFrameTime)
      previousFrameTime = time
      const difference = Math.log(scale.value / renderedScale.value)
      const remainingPixels = Math.abs(scale.value - renderedScale.value) * Math.max(natural.value.width, natural.value.height)
      renderedScale.value = remainingPixels < .1 ? scale.value
        : renderedScale.value * Math.exp(difference * (1 - Math.exp(-elapsed / 20)))
      animation = renderedScale.value === scale.value ? undefined : requestAnimationFrame(frame)
      return
    }
    const progress = Math.max(0, Math.min(1, (time - animationStart) / 90))
    const eased = 1 - (1 - progress) ** 3
    renderedScale.value = progress === 1 ? scale.value
      : Math.exp(Math.log(animationFrom) + Math.log(scale.value / animationFrom) * eased)
    animation = progress === 1 ? undefined : requestAnimationFrame(frame)
  }
  watch(scale, value => {
    if (initializing || !natural.value.width || reducedMotion?.matches) {
      stopAnimation()
      renderedScale.value = value
    } else if (precisionInput) {
      // Retarget one running loop instead of restarting easing for every pinch event.
      if (animation !== undefined && precisionAnimation) return
      stopAnimation()
      precisionAnimation = true
      previousFrameTime = performance.now()
      animation = requestAnimationFrame(frame)
    } else {
      stopAnimation()
      precisionAnimation = false
      animationStart = performance.now()
      animationFrom = renderedScale.value
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
    endPan()
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
  function setScale(value: number, clientX?: number, clientY?: number, precision = false) {
    if (!natural.value.width || !Number.isFinite(value)) return
    endPan()
    precisionInput = precision
    const element = viewport.value
    const rect = element?.getBoundingClientRect()
    const samePivot = precision && performance.now() - lastPrecisionTime < 160 && anchor && element && rect
      && clientX !== undefined && clientY !== undefined
      && Math.abs(anchor.x - (clientX - rect.left - element.clientLeft)) < .5
      && Math.abs(anchor.y - (clientY - rect.top - element.clientTop)) < .5
    // Keep the gesture's original image point; repeated scroll rounding otherwise drifts.
    if (!samePivot) setAnchor(clientX, clientY)
    if (!precision) { lastPrecisionTime = -Infinity; precisionDirection = 0 }
    manualScale.value = Math.max(.01, Math.min(8, value))
    fit.value = false
  }
  function zoom(direction: number) {
    if (direction < 0 && scale.value <= .01) return
    setScale(scale.value * (direction > 0 ? 1.35 : 1 / 1.35))
  }
  function wheel(event: WheelEvent) {
    if (!event.ctrlKey) { anchor = undefined; lastPrecisionTime = -Infinity; return }
    if (!Number.isFinite(event.deltaY) || !event.deltaY) return
    event.preventDefault()
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.value.height : 1)
    const now = performance.now()
    const sameGesture = now - lastPrecisionTime < 160
    // WheelEvent has no device identifier. Small pixel deltas identify high-resolution input.
    const precision = event.deltaMode === 0 && (Math.abs(pixels) < 50 || sameGesture)
    const direction = Math.sign(pixels)
    const reversing = precision && sameGesture && precisionDirection !== direction
    const base = reversing ? renderedScale.value : scale.value
    const limit = precision ? 60 : 120
    setScale(base * Math.exp(-Math.max(-limit, Math.min(limit, pixels)) * (precision ? .0025 : .004)), event.clientX, event.clientY, precision)
    if (precision) { lastPrecisionTime = now; precisionDirection = direction }
  }
  function startPan(event: PointerEvent) {
    const element = viewport.value
    if (!element || !natural.value.width || !canPan.value || event.button !== 0 || drag) return
    stopAnimation()
    precisionInput = false; lastPrecisionTime = -Infinity; precisionDirection = 0
    initializing = true
    manualScale.value = renderedScale.value; fit.value = false
    initializing = false
    anchor = undefined
    drag = { element, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }
    dragging.value = true
    element.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  function pan(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.element.scrollLeft = drag.left - (event.clientX - drag.x)
    drag.element.scrollTop = drag.top - (event.clientY - drag.y)
    event.preventDefault()
  }
  function endPan(event?: PointerEvent) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    const previous = drag
    drag = undefined; dragging.value = false
    if (previous.element.hasPointerCapture?.(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId)
  }
  function fitImage() {
    endPan(); anchor = undefined; precisionInput = false; lastPrecisionTime = -Infinity; precisionDirection = 0
    fit.value = true; measure(); viewport.value?.scrollTo({ left: 0, top: 0 })
  }
  function reset() {
    stopAnimation(); anchor = undefined; initializing = true
    natural.value = { width: 0, height: 0 }; manualScale.value = 1; fitImage(); renderedScale.value = scale.value
    initializing = false
  }
  onBeforeUnmount(() => { observer?.disconnect(); stopAnimation(); endPan() })
  return { viewport, natural, scale, renderedScale, percent, imageStyle, canvasStyle, dragging, canPan,
    loaded, loadImage, zoom, wheel, setScale, fitImage, reset, startPan, pan, endPan }
}
