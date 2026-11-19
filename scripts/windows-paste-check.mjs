import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import koffi from 'koffi'

async function waitFor(check, message, timeout = 2500) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(20)
  }
  assert.fail(await message())
}

export async function checkWindowsPaste(window) {
  const profile = await mkdtemp(path.join(process.env.CLIPCLIP_TEST_USER_DATA, 'windows-paste-target-'))
  const commandFile = path.join(profile, 'commands.jsonl')
  const eventFile = path.join(profile, 'events.jsonl')
  await Promise.all([writeFile(commandFile, ''), writeFile(eventFile, '')])
  const user32 = koffi.load('user32.dll')
  const getForeground = user32.func('uintptr_t __stdcall GetForegroundWindow()')
  const foreground = () => BigInt(getForeground())
  const switchWindow = user32.func('void __stdcall SwitchToThisWindow(uintptr_t hwnd, int altTab)')
  const handle = window.getNativeWindowHandle()
  const clipClipHwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
  const evaluate = code => window.webContents.executeJavaScript(code)
  window.show()
  app.focus({ steal: true })
  window.focus()

  const fixture = spawn(process.execPath, [
    '--disable-gpu',
    fileURLToPath(new URL('./windows-paste-target.mjs', import.meta.url)),
    profile,
    String(process.pid),
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  let fixtureError
  const exited = once(fixture, 'close').catch(error => { fixtureError = error })
  const readEvents = async () => (await readFile(eventFile, 'utf8')).split('\n').slice(0, -1).map(line => JSON.parse(line))
  let commandId = 0
  async function sendCommand(type) {
    const id = ++commandId
    await appendFile(commandFile, JSON.stringify({ id, type }) + '\n')
    return id
  }
  async function waitForEvent(type, id, timeout) {
    let event
    let events
    await waitFor(async () => {
      events = await readEvents()
      const childError = events.find(message => message.type === 'error')?.error
      assert.ok(!childError, childError)
      assert.ifError(fixtureError)
      assert.equal(fixture.exitCode, null, `Paste target exited early: ${JSON.stringify(events)}`)
      event = events.find(message => message.type === type && (id === undefined || message.id === id))
      return Boolean(event)
    }, () => `Paste target did not report ${type}: ${JSON.stringify(events)}`, timeout)
    return event
  }
  const waitForForeground = (hwnd, description) => waitFor(() => foreground() === hwnd,
    () => `${description} did not gain focus (expected ${hwnd}, got ${foreground()})`)

  let targetHwnd
  async function grantFocus(timeout) {
    const id = await sendCommand('grant')
    const result = await waitForEvent('grant', id, timeout)
    assert.ok(result.granted, `Paste target could not grant foreground access (foreground HWND ${foreground()})`)
  }

  async function openFromTarget() {
    await waitForForeground(targetHwnd, 'External paste target before opening ClipClip')
    await grantFocus()
    assert.equal(foreground(), targetHwnd, 'The paste target must own focus when ClipClip opens')
    // Use ClipClip's production open handler so the caller window is captured.
    app.emit('second-instance')
    await waitForForeground(clipClipHwnd, 'ClipClip')
    await waitFor(() => evaluate('document.activeElement?.id === "history-search" && Boolean(document.querySelector(".record-select[aria-pressed=true]"))'),
      () => 'The opened picker did not focus search and select a record')
  }

  async function selectWithEnter() {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await waitFor(() => !window.isVisible(), async () => {
      const alert = await evaluate('document.querySelector(".error-notice")?.textContent ?? document.querySelector("[role=alert]")?.textContent')
      return 'Enter did not hide ClipClip after choosing a record' + (alert ? ': ' + alert : '')
    })
  }

  try {
    const target = await waitForEvent('ready', undefined, 6000)
    assert.notEqual(target.pid, process.pid)
    assert.equal(target.pid, fixture.pid)
    targetHwnd = BigInt(target.hwnd)
    // Keep the rest of the smoke suite from sending input to the desktop.
    process.env.CLIPCLIP_TEST_PASTE_TARGET_PID = String(target.pid)
    await evaluate('window.electronAPI.hideWindow()')
    // Bootstrap the synthetic desktop scenario even if the test runner started in the background.
    if (foreground() !== targetHwnd) switchWindow(targetHwnd, 1)
    await openFromTarget()
    await selectWithEnter()
    await waitForEvent('paste')
    await waitForForeground(targetHwnd, 'External paste target after selection')
    assert.equal((await readEvents()).filter(event => event.type === 'paste').length, 1)

    await evaluate('window.electronAPI.setPasteOnSelect(false)')
    await openFromTarget()
    await selectWithEnter()
    await delay(250)
    assert.equal((await readEvents()).filter(event => event.type === 'paste').length, 1, 'Disabling auto-paste must suppress Ctrl+V')
    console.log('Windows picker Enter returned focus and delivered Ctrl+V to a separate process only when enabled.')
  } finally {
    delete process.env.CLIPCLIP_TEST_PASTE_TARGET_PID
    try {
      if (targetHwnd && foreground() === targetHwnd) await grantFocus(500).catch(() => {})
      window.show()
      app.focus({ steal: true })
      window.focus()
      await evaluate('window.electronAPI.setPasteOnSelect(true)')
    } finally {
      await sendCommand('quit').catch(() => {})
      const kill = setTimeout(() => fixture.kill(), 1000)
      await exited
      clearTimeout(kill)
    }
  }
}
