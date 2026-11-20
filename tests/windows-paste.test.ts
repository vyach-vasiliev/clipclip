import { describe, expect, it, vi } from 'vitest'
import { ClipboardChangedError, createPasteController, type PasteApi } from '../electron/main/windowsPaste'

const picker = 11n
const sequence = 17

function setup() {
  const api: PasteApi = { foreground: vi.fn(() => 42n), processId: vi.fn(() => 7), usable: vi.fn(() => true),
    activate: vi.fn(), keyDown: vi.fn(() => false), clipboardSequence: vi.fn(() => sequence), sendPaste: vi.fn(() => true) }
  const controller = createPasteController(api, 99)
  controller.capture()
  vi.mocked(api.foreground).mockReturnValue(picker)
  vi.mocked(api.activate).mockImplementation(hwnd => vi.mocked(api.foreground).mockReturnValue(hwnd))
  const target = controller.target()!
  return { api, controller, target, paste: (current = () => true) => controller.paste(target, picker, sequence, current) }
}

describe('Windows paste focus', () => {
  it('pastes in the already focused window without activating it again', async () => {
    const { api, controller, target } = setup()
    vi.mocked(api.foreground).mockReturnValue(target.hwnd)
    expect(controller.foregroundTarget()).toEqual(target)
    await controller.pasteIntoForeground(target, sequence, () => true)
    expect(api.activate).not.toHaveBeenCalled()
    expect(api.sendPaste).toHaveBeenCalledOnce()
  })
  it('does not paste if another window gets focus during quick selection', async () => {
    const { api, controller, target } = setup()
    vi.mocked(api.foreground).mockReturnValue(target.hwnd)
    vi.mocked(api.keyDown).mockReturnValueOnce(true)
    const pending = controller.pasteIntoForeground(target, sequence, () => true)
    vi.mocked(api.foreground).mockReturnValue(55n)
    await expect(pending).rejects.toThrow('фокус')
    expect(api.activate).not.toHaveBeenCalled()
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
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
    const { api, paste, target } = setup()
    vi.mocked(api.activate).mockImplementationOnce(() => {
      expect(api.foreground()).toBe(picker)
      vi.mocked(api.foreground).mockReturnValueOnce(picker).mockReturnValue(target.hwnd)
    })
    const pending = paste()
    expect(api.sendPaste).not.toHaveBeenCalled()
    await pending
    expect(api.activate).toHaveBeenCalledWith(42n)
    expect(api.sendPaste).toHaveBeenCalledOnce()
  })
  it('waits until Enter and modifiers are released', async () => {
    const { api, paste } = setup()
    vi.mocked(api.keyDown).mockReturnValueOnce(true)
    const pending = paste()
    expect(api.activate).not.toHaveBeenCalled()
    expect(api.sendPaste).not.toHaveBeenCalled()
    await pending
    expect(api.sendPaste).toHaveBeenCalledOnce()
  })
  it('does not paste into a different foreground window', async () => {
    const { api, paste } = setup()
    vi.mocked(api.activate).mockImplementationOnce(() => { vi.mocked(api.foreground).mockReturnValue(55n) })
    await expect(paste()).rejects.toThrow('фокус')
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
  it('does not try to steal focus if the user already switched windows', async () => {
    const { api, paste } = setup()
    vi.mocked(api.foreground).mockReturnValue(55n)
    await expect(paste()).rejects.toThrow('фокус')
    expect(api.activate).not.toHaveBeenCalled()
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
  it('rejects a reused window handle and a cancelled invocation', async () => {
    const { api, controller, paste } = setup()
    vi.mocked(api.processId).mockReturnValue(8)
    expect(controller.target()).toBeNull()
    await expect(paste()).rejects.toThrow()
    vi.mocked(api.processId).mockReturnValue(7)
    await expect(paste(() => false)).rejects.toThrow()
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
  it('reports input blocked by Windows', async () => {
    const { api, paste } = setup()
    vi.mocked(api.sendPaste).mockReturnValue(false)
    await expect(paste()).rejects.toThrow('не разрешила')
  })
  it('cancels if the clipboard changes before focus moves', async () => {
    const { api, paste } = setup()
    vi.mocked(api.keyDown).mockReturnValueOnce(true)
    const pending = paste()
    vi.mocked(api.clipboardSequence).mockReturnValue(sequence + 1)
    await expect(pending).rejects.toBeInstanceOf(ClipboardChangedError)
    expect(api.activate).not.toHaveBeenCalled()
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
  it('rechecks the clipboard after focus moves and immediately before sending input', async () => {
    const { api, paste } = setup()
    vi.mocked(api.clipboardSequence).mockReturnValueOnce(sequence).mockReturnValueOnce(sequence).mockReturnValue(sequence + 1)
    await expect(paste()).rejects.toBeInstanceOf(ClipboardChangedError)
    expect(api.activate).toHaveBeenCalledWith(42n)
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
  it('fails closed when the clipboard sequence cannot be established', async () => {
    const { api, controller, target } = setup()
    await expect(controller.paste(target, picker, 0, () => true)).rejects.toBeInstanceOf(ClipboardChangedError)
    expect(api.activate).not.toHaveBeenCalled()
    expect(api.sendPaste).not.toHaveBeenCalled()
  })
})
