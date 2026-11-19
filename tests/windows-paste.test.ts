import { describe, expect, it, vi } from 'vitest'
import { createPasteController, type PasteApi } from '../electron/main/windowsPaste'

const picker = 11n

function setup() {
  const api: PasteApi = { foreground: vi.fn(() => 42n), processId: vi.fn(() => 7), usable: vi.fn(() => true),
    activate: vi.fn(), keyDown: vi.fn(() => false), sendPaste: vi.fn(() => true) }
  const controller = createPasteController(api, 99)
  controller.capture()
  vi.mocked(api.foreground).mockReturnValue(picker)
  vi.mocked(api.activate).mockImplementation(hwnd => vi.mocked(api.foreground).mockReturnValue(hwnd))
  return { api, controller, target: controller.target()! }
}

describe('Windows paste focus', () => {
  it('preserves the external target while ClipClip or the taskbar has focus', () => {
    const { api, controller, target } = setup()
    vi.mocked(api.processId).mockReturnValue(99)
    controller.capture()
    vi.mocked(api.processId).mockReturnValue(7)
    vi.mocked(api.usable).mockReturnValueOnce(false)
    controller.capture()
    expect(controller.target()).toEqual(target)
  })
  it('restores the captured target and sends paste once', async () => {
    const { api, controller, target } = setup()
    vi.mocked(api.activate).mockImplementationOnce(() => {
      expect(api.foreground()).toBe(picker)
      vi.mocked(api.foreground).mockReturnValueOnce(picker).mockReturnValue(target.hwnd)
    })
    const pending = controller.paste(target, picker, () => true)
    expect(api.sendPaste).not.toHaveBeenCalled()
    await pending
    expect(api.activate).toHaveBeenCalledWith(42n)
    expect(api.sendPaste).toHaveBeenCalledOnce()
  })
  it('waits until Enter and modifiers are released', async () => {
    const { api, controller, target } = setup()
    vi.mocked(api.keyDown).mockReturnValueOnce(true)
    const pending = controller.paste(target, picker, () => true)
    expect(api.activate).not.toHaveBeenCalled()
    expect(api.sendPaste).not.toHaveBeenCalled()
    await pending
    expect(api.sendPaste).toHaveBeenCalledOnce()
  })
  it('does not paste into a different foreground window', async () => {
    const { api, controller, target } = setup()
    vi.mocked(api.activate).mockImplementationOnce(() => { vi.mocked(api.foreground).mockReturnValue(55n) })
    await expect(controller.paste(target, picker, () => true)).rejects.toThrow('фокус')
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
  it('does not try to steal focus if the user already switched windows', async () => {
    const { api, controller, target } = setup()
    vi.mocked(api.foreground).mockReturnValue(55n)
    await expect(controller.paste(target, picker, () => true)).rejects.toThrow('фокус')
    expect(api.activate).not.toHaveBeenCalled()
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
  it('rejects a reused window handle and a cancelled invocation', async () => {
    const { api, controller, target } = setup()
    vi.mocked(api.processId).mockReturnValue(8)
    expect(controller.target()).toBeNull()
    await expect(controller.paste(target, picker, () => true)).rejects.toThrow()
    vi.mocked(api.processId).mockReturnValue(7)
    await expect(controller.paste(target, picker, () => false)).rejects.toThrow()
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
  it('reports input blocked by Windows', async () => {
    const { api, controller, target } = setup()
    vi.mocked(api.sendPaste).mockReturnValue(false)
    await expect(controller.paste(target, picker, () => true)).rejects.toThrow('не разрешила')
  })
})
