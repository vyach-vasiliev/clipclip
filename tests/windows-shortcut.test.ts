import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { createWindowsShortcut } from '../electron/main/windowsShortcut'

const native = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn() }))
vi.mock('koffi', () => ({ default: { load: () => ({ func: (declaration: string) => declaration.includes(' RegisterHotKey(') ? native.register : native.unregister }) } }))
beforeEach(() => { native.register.mockReset().mockReturnValue(1); native.unregister.mockReset() })
function setup() {
  let receive!: (parameter: Buffer) => void
  const handle = Buffer.alloc(8); handle.writeBigUInt64LE(123n)
  const window = { getNativeWindowHandle: () => handle, isDestroyed: () => false,
    hookWindowMessage: vi.fn((_message, callback) => { receive = callback }), unhookWindowMessage: vi.fn() }
  const invoke = vi.fn()
  return { controller: createWindowsShortcut(window as unknown as BrowserWindow, invoke), invoke, window,
    send: (id: number) => { const parameter = Buffer.alloc(8); parameter.writeBigUInt64LE(BigInt(id)); receive(parameter) } }
}
describe('native Windows hotkey replacement', () => {
  it('retains the old binding when a new shortcut is occupied', () => {
    const { controller, send, invoke } = setup()
    expect(controller.set()).toBe(true)
    expect(native.register).toHaveBeenLastCalledWith(123n, 0x4343, 0x4003, 0x42)
    native.register.mockReturnValueOnce(0)
    expect(controller.set('Ctrl+Shift+Q')).toBe(false)
    expect(native.unregister).not.toHaveBeenCalled()
    send(0x4343)
    expect(invoke).toHaveBeenCalledOnce()
    controller.dispose()
  })
  it('registers the replacement before releasing the old one and disposes once', () => {
    const { controller, send, invoke, window } = setup()
    controller.set()
    expect(controller.set('Ctrl+Shift+Q')).toBe(true)
    expect(native.register).toHaveBeenLastCalledWith(123n, 0x4344, 0x4006, 0x51)
    expect(native.register.mock.invocationCallOrder[1]).toBeLessThan(native.unregister.mock.invocationCallOrder[0])
    send(0x4343); expect(invoke).not.toHaveBeenCalled()
    send(0x4344); expect(invoke).toHaveBeenCalledOnce()
    controller.dispose(); controller.dispose()
    expect(native.unregister.mock.calls.map(call => call[1])).toEqual([0x4343, 0x4344])
    expect(window.unhookWindowMessage).toHaveBeenCalledOnce()
    expect(controller.set('Ctrl+Q')).toBe(false)
  })
  it('preserves the active binding when a reserved replacement is cancelled', () => {
    const { controller, send, invoke } = setup()
    controller.set()
    const candidate = controller.reserve('Ctrl+Shift+Q')
    expect(candidate).not.toBeNull()
    expect(native.unregister).not.toHaveBeenCalled()
    send(0x4344); expect(invoke).not.toHaveBeenCalled()
    send(0x4343); expect(invoke).toHaveBeenCalledOnce()
    candidate!.cancel()
    expect(native.unregister.mock.calls.map(call => call[1])).toEqual([0x4344])
    send(0x4343); expect(invoke).toHaveBeenCalledTimes(2)
    controller.dispose()
  })
})
