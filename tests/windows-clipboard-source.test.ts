import { describe, expect, it, vi } from 'vitest'
import { createClipboardOwnerReader, createWindowsClipboardOwnerListener, WM_CLIPBOARDUPDATE, type ClipboardOwnerApi } from '../electron/main/windowsClipboardSource'

function setup() {
  const api: ClipboardOwnerApi = {
    sequence: vi.fn(() => 10), owner: vi.fn(() => 123n), processId: vi.fn(() => 42),
    processPath: vi.fn(() => 'C:\\WindowsApps\\SnippingTool.exe'), title: vi.fn(() => 'Ножницы'),
  }
  return { api, reader: createClipboardOwnerReader(api, 99) }
}

describe('experimental Windows clipboard image source', () => {
  function listenerWindow() {
    const handle = Buffer.alloc(8); handle.writeBigUInt64LE(123n)
    return { getNativeWindowHandle: () => handle, hookWindowMessage: vi.fn(),
      unhookWindowMessage: vi.fn(), isDestroyed: vi.fn(() => false) }
  }
  it('captures the owner on notification before it closes between polls', () => {
    const { api, reader } = setup()
    vi.mocked(api.owner).mockReturnValue(0)
    const window = listenerWindow()
    const listenerApi = { add: vi.fn(() => true), remove: vi.fn() }
    const listener = createWindowsClipboardOwnerListener(window, reader, listenerApi)
    expect(listenerApi.add).toHaveBeenCalledWith(123n)
    expect(window.hookWindowMessage).toHaveBeenCalledWith(WM_CLIPBOARDUPDATE, expect.any(Function))
    const onUpdate = window.hookWindowMessage.mock.calls[0][1]
    vi.mocked(api.owner).mockReturnValue(123n)
    onUpdate()
    vi.mocked(api.owner).mockReturnValue(0)
    expect(reader.resolve(reader.capture())?.name).toBe('Ножницы')
    listener.dispose(); listener.dispose()
    expect(listenerApi.remove).toHaveBeenCalledExactlyOnceWith(123n)
    expect(window.unhookWindowMessage).toHaveBeenCalledExactlyOnceWith(WM_CLIPBOARDUPDATE)
    vi.mocked(api.sequence).mockReturnValue(11)
    vi.mocked(api.owner).mockClear()
    onUpdate()
    expect(api.owner).not.toHaveBeenCalled()
  })
  it('cleans up a failed notification registration', () => {
    const window = listenerWindow()
    const reader = { capture: vi.fn() }
    expect(() => createWindowsClipboardOwnerListener(window, reader, { add: () => false, remove: vi.fn() })).toThrow('notifications')
    expect(window.unhookWindowMessage).toHaveBeenCalledWith(WM_CLIPBOARDUPDATE)
    expect(reader.capture).not.toHaveBeenCalled()
  })
  it('isolates reader errors and safely disposes after the window is destroyed', () => {
    const window = listenerWindow()
    const reader = { capture: vi.fn(() => { throw new Error('unavailable') }) }
    const api = { add: () => true, remove: vi.fn() }
    const listener = createWindowsClipboardOwnerListener(window, reader, api)
    expect(reader.capture).toHaveBeenCalledOnce()
    expect(() => window.hookWindowMessage.mock.calls[0][1]()).not.toThrow()
    window.isDestroyed.mockReturnValue(true)
    listener.dispose()
    expect(api.remove).toHaveBeenCalledOnce()
    expect(window.unhookWindowMessage).not.toHaveBeenCalled()
  })
  it.each(['SnippingTool', 'ScreenClippingHost', 'ScreenSketch'])('identifies %s from the clipboard owner rather than the active app', executable => {
    const { api, reader } = setup()
    vi.mocked(api.processPath).mockReturnValue('C:\\WindowsApps\\' + executable + '.exe')
    expect(reader.resolve(reader.capture())).toEqual({ name: 'Ножницы', title: 'Ножницы' })
    expect(api.processId).toHaveBeenCalledWith(123n)
    expect(api.processPath).toHaveBeenCalledWith(42)
  })
  it('uses other executable names without inventing screenshot attribution', () => {
    const { api, reader } = setup()
    vi.mocked(api.processPath).mockReturnValue('C:\\Apps\\Editor.EXE')
    vi.mocked(api.title).mockReturnValue('Example document')
    expect(reader.resolve(reader.capture())).toEqual({ name: 'Editor', title: 'Example document' })
  })
  it('retains a valid capture for the same clipboard contents after its owner window closes', () => {
    const { api, reader } = setup()
    const first = reader.capture()
    vi.mocked(api.owner).mockReturnValue(0)
    expect(reader.capture()).toBe(first)
    expect(reader.resolve(first)?.name).toBe('Ножницы')
    expect(api.processPath).toHaveBeenCalledTimes(1)
    vi.mocked(api.sequence).mockReturnValue(11)
    expect(reader.capture()).toBeUndefined()
    expect(reader.resolve(first)).toBeUndefined()
  })
  it('discards attribution if the clipboard changes during or after owner lookup', () => {
    const { api, reader } = setup()
    vi.mocked(api.sequence).mockReturnValueOnce(10).mockReturnValue(11)
    expect(reader.capture()).toBeUndefined()
    const second = reader.capture()
    vi.mocked(api.sequence).mockReturnValue(12)
    expect(reader.resolve(second)).toBeUndefined()
  })
  it.each(['no-owner', 'own-process', 'no-process', 'denied', 'unavailable', 'no-sequence'])('allows the existing source fallback for %s', scenario => {
    const { api, reader } = setup()
    if (scenario === 'no-owner') vi.mocked(api.owner).mockReturnValue(0)
    if (scenario === 'own-process') vi.mocked(api.processId).mockReturnValue(99)
    if (scenario === 'no-process') vi.mocked(api.processId).mockReturnValue(0)
    if (scenario === 'denied') vi.mocked(api.processPath).mockReturnValue(undefined)
    if (scenario === 'unavailable') vi.mocked(api.owner).mockImplementation(() => { throw new Error('unavailable') })
    if (scenario === 'no-sequence') vi.mocked(api.sequence).mockReturnValue(0)
    expect(reader.capture()).toBeUndefined()
    expect(reader.resolve(undefined)).toBeUndefined()
  })
})
