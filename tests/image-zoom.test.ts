// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useImageZoom } from '../src/composables/imageZoom'

const wrappers: ReturnType<typeof mount>[] = []
let resized: () => void
function setup(reducedMotion = false) {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  let time = performance.now()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect() {} })
  let zoom!: ReturnType<typeof useImageZoom>
  wrappers.push(mount(defineComponent({ setup() { zoom = useImageZoom(); return () => null } })))
  const viewport = document.createElement('div')
  Object.defineProperties(viewport, { clientWidth: { value: 300, configurable: true }, clientHeight: { value: 200, configurable: true } })
  viewport.scrollTo = vi.fn()
  zoom.viewport.value = viewport
  const image = document.createElement('img')
  Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } })
  zoom.loadImage(image)
  const advance = async (count = 1) => {
    for (let step = 0; step < count; step++) {
      time += 16
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(time))
      await nextTick()
    }
  }
  return { zoom, viewport, image, advance, frames }
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals() })
describe('image viewing', () => {
  it('fits instantly on load and interpolates magnification without changing the image layout size', async () => {
    const { zoom, advance } = setup()
    expect(zoom.percent.value).toBe(25)
    expect(zoom.canvasStyle.value.width).toBe('300px')
    zoom.zoom(1)
    expect(zoom.percent.value).toBe(25)
    await advance()
    expect(zoom.renderedScale.value).toBeGreaterThan(.25)
    expect(zoom.renderedScale.value).toBeLessThan(.3)
    expect(zoom.imageStyle.value.width).toBe('1200px')
    await advance(30)
    expect(zoom.percent.value).toBe(30)
    zoom.setScale(1)
    await advance(30)
    expect(zoom.canvasStyle.value.width).toBe('1200px')
    zoom.fitImage()
    await advance(30)
    expect(zoom.percent.value).toBe(25)
  })
  it('refits on resize while preserving an explicit zoom level', async () => {
    const { zoom, viewport, advance } = setup()
    await nextTick()
    Object.defineProperty(viewport, 'clientWidth', { value: 600 })
    Object.defineProperty(viewport, 'clientHeight', { value: 400 })
    resized()
    await advance(30)
    expect(zoom.percent.value).toBe(50)
    zoom.setScale(2)
    resized()
    await advance(30)
    expect(zoom.percent.value).toBe(200)
  })
  it('bounds magnification and reserves Ctrl+wheel for image zoom', () => {
    const { zoom } = setup(true)
    zoom.setScale(100)
    expect(zoom.percent.value).toBe(800)
    zoom.setScale(0)
    expect(zoom.percent.value).toBe(1)
    const ordinary = new WheelEvent('wheel', { deltaY: -100, cancelable: true })
    zoom.wheel(ordinary)
    expect(ordinary.defaultPrevented).toBe(false)
    const modified = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true })
    zoom.wheel(modified)
    expect(modified.defaultPrevented).toBe(true)
    expect(zoom.scale.value).toBeGreaterThan(.01)
  })
  it('accumulates small wheel deltas, keeps the cursor anchor, and can reverse an unfinished zoom', async () => {
    const { zoom, viewport, advance } = setup()
    zoom.setScale(1)
    await advance(30)
    viewport.scrollLeft = 100
    viewport.scrollTop = 100
    zoom.wheel(new WheelEvent('wheel', { deltaY: -5, ctrlKey: true, clientX: 150, clientY: 100, cancelable: true }))
    expect(zoom.scale.value).toBeCloseTo(Math.exp(.0075))
    await advance(30)
    expect((viewport.scrollLeft + 150) / zoom.renderedScale.value).toBeCloseTo(250)
    zoom.zoom(1)
    await advance(2)
    const intermediate = zoom.renderedScale.value
    zoom.setScale(.5)
    await advance()
    expect(zoom.renderedScale.value).toBeLessThan(intermediate)
    expect(zoom.renderedScale.value).toBeGreaterThan(.5)
    await advance(30)
    expect(zoom.percent.value).toBe(50)
  })
  it('cancels pending animation on reset and unmount', () => {
    const { zoom, image, frames } = setup()
    zoom.zoom(1)
    expect(frames.size).toBe(1)
    zoom.reset()
    expect(frames.size).toBe(0)
    zoom.loadImage(image)
    zoom.zoom(1)
    expect(frames.size).toBe(1)
    wrappers[0].unmount()
    expect(frames.size).toBe(0)
  })
})
