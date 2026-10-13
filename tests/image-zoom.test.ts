// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useImageZoom } from '../src/composables/imageZoom'

const wrappers: ReturnType<typeof mount>[] = []
let resized: () => void
function setup() {
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
  return { zoom, viewport }
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals() })
describe('image viewing', () => {
  it('fits the image, scrolls at higher magnification, and returns to fit', () => {
    const { zoom } = setup()
    expect(zoom.percent.value).toBe(25)
    expect(zoom.imageStyle.value.width).toBe('300px')
    zoom.zoom(1)
    expect(zoom.percent.value).toBe(31)
    expect(Number.parseFloat(zoom.imageStyle.value.width!)).toBeGreaterThan(300)
    zoom.setScale(1)
    expect(zoom.imageStyle.value.width).toBe('1200px')
    zoom.fitImage()
    expect(zoom.percent.value).toBe(25)
  })
  it('refits on resize while preserving an explicit zoom level', async () => {
    const { zoom, viewport } = setup()
    await nextTick()
    Object.defineProperty(viewport, 'clientWidth', { value: 600 })
    Object.defineProperty(viewport, 'clientHeight', { value: 400 })
    resized()
    expect(zoom.percent.value).toBe(50)
    zoom.setScale(2)
    resized()
    expect(zoom.percent.value).toBe(200)
  })
  it('bounds magnification and reserves Ctrl+wheel for image zoom', () => {
    const { zoom } = setup()
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
})
