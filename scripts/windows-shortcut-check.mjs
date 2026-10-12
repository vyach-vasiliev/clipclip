import assert from 'node:assert/strict'
import koffi from 'koffi'
import { app } from 'electron'

export async function checkWindowsShortcut(window) {
  const lib = koffi.load('user32.dll')
  const layouts = lib.func('int __stdcall GetKeyboardLayoutList(int count, _Out_ uintptr_t *layouts)')
  const thread = lib.func('uint __stdcall GetWindowThreadProcessId(uintptr_t hwnd, void *pid)')
  const getLayout = lib.func('uintptr_t __stdcall GetKeyboardLayout(uint thread)')
  const post = lib.func('int __stdcall PostMessageW(uintptr_t hwnd, uint message, uintptr_t wparam, intptr_t lparam)')
  const foreground = lib.func('uintptr_t __stdcall GetForegroundWindow()')
  const key = lib.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint flags, uintptr_t extra)')
  const handle = window.getNativeWindowHandle()
  const hwnd = handle.readBigUInt64LE()
  const threadId = thread(hwnd, null)
  const previousLayout = getLayout(threadId)
  const available = new Array(layouts(0, null)).fill(0)
  layouts(available.length, available)
  const selected = available.filter(layout => [0x0409, 0x0419].includes(Number(BigInt(layout) & 0xffffn)))
  assert.ok(selected.length, 'No English or Russian input layout installed for shortcut verification')
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  const evaluate = code => window.webContents.executeJavaScript(code)
  await evaluate('window.__shortcutEvents = 0; window.electronAPI.onWindowShown(() => { window.__shortcutEvents++ }); void 0')
  try {
    for (const layout of selected) {
      window.setAlwaysOnTop(true)
      window.show(); app.focus({ steal: true }); window.focus()
      // A desktop launched in the background may need explicit test-window focus.
      for (let attempt = 0; attempt < 100 && BigInt(foreground()) !== hwnd; attempt++) await delay(200)
      // Change only the test window's input layout; never load or install a layout.
      assert.ok(post(hwnd, 0x0050, 0, layout))
      await delay(100)
      assert.equal(BigInt(getLayout(threadId)), BigInt(layout))
      assert.equal(BigInt(foreground()), hwnd, 'Fixture must own focus before synthesizing a shortcut')
      const before = await evaluate('window.__shortcutEvents')
      try {
        key(0x11, 0x1d, 0, 0); key(0x12, 0x38, 0, 0); key(0x42, 0x30, 0, 0)
        await delay(60)
      } finally {
        key(0x42, 0x30, 2, 0); key(0x12, 0x38, 2, 0); key(0x11, 0x1d, 2, 0)
      }
      await delay(150)
      assert.equal(await evaluate('window.__shortcutEvents'), before + 1)
      console.log('Native Ctrl+Alt+B passed for input layout ' + Number(BigInt(layout) & 0xffffn).toString(16))
    }
    // The same registered message still opens the window while it is hidden.
    window.hide()
    assert.ok(post(hwnd, 0x0312, 0x4343, 0x00420003))
    await delay(100)
    assert.equal(window.isVisible(), true)
  } finally {
    window.setAlwaysOnTop(false)
    post(hwnd, 0x0050, 0, previousLayout)
    await delay(100)
  }
}
