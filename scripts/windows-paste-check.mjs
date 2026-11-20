import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { app, nativeTheme, screen } from 'electron'
import koffi from 'koffi'

const TEST_KEY_MARKER = 0x434c4950
koffi.struct('ClipClipPasteFixturePoint', { x: 'int32_t', y: 'int32_t' })
const inputSize = process.arch === 'ia32' ? 28 : 40
const inputOffset = process.arch === 'ia32' ? 4 : 8

async function waitFor(check, message, timeout = 2500) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(20)
  }
  assert.fail(await message())
}

export async function checkWindowsPaste(window, { quickOnly = false } = {}) {
  const profile = await mkdtemp(path.join(process.env.CLIPCLIP_TEST_USER_DATA, 'windows-paste-target-'))
  const commandFile = path.join(profile, 'commands.jsonl')
  const eventFile = path.join(profile, 'events.jsonl')
  const clipboardFile = path.join(profile, 'clipboard.json')
  await Promise.all([writeFile(commandFile, ''), writeFile(eventFile, '')])
  const user32 = koffi.load('user32.dll')
  const getForeground = user32.func('uintptr_t __stdcall GetForegroundWindow()')
  const foreground = () => BigInt(getForeground())
  const switchWindow = user32.func('void __stdcall SwitchToThisWindow(uintptr_t hwnd, int altTab)')
  const allowForeground = user32.func('int __stdcall AllowSetForegroundWindow(uint32_t pid)')
  const sendInput = user32.func('uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)')
  const getRoot = user32.func('uintptr_t __stdcall GetAncestor(uintptr_t hwnd, uint32_t flags)')
  const windowFromPoint = user32.func('uintptr_t __stdcall WindowFromPoint(ClipClipPasteFixturePoint point)')
  const getCursor = user32.func('int __stdcall GetCursorPos(_Out_ ClipClipPasteFixturePoint *point)')
  const setCursor = user32.func('int __stdcall SetCursorPos(int x, int y)')
  const handle = window.getNativeWindowHandle()
  const clipClipHwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
  const evaluate = code => window.webContents.executeJavaScript(code)
  const selected = await evaluate('(async () => (await window.electronAPI.getHistory()).items.find(item => !item.pinned && item.type === "text" && item.data.includes("Многострочная запись")))()')
  assert.ok(selected, 'The picker must contain the synthetic text fixture')
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
  let replaceBeforePaste = false
  let copiedSequence
  function writeSyntheticClipboard({ sequence, snapshot }, replace) {
    assert.equal(snapshot.text, selected.data)
    assert.ok(sequence > 0, 'The synthetic clipboard must have a valid sequence')
    copiedSequence = sequence
    writeFileSync(clipboardFile, JSON.stringify({ sequence, text: snapshot.text }))
    if (replaceBeforePaste) {
      replace()
      writeFileSync(clipboardFile, JSON.stringify({ sequence: sequence + 1, text: 'Another synthetic value' }))
    }
  }
  async function grantFocus(timeout) {
    const id = await sendCommand('grant')
    const result = await waitForEvent('grant', id, timeout)
    assert.ok(result.granted, `Paste target could not grant foreground access (foreground HWND ${foreground()})`)
  }

  async function focusTarget(pid) {
    if (foreground() === targetHwnd) return
    if (foreground() !== clipClipHwnd) {
      const wasAlwaysOnTop = window.isAlwaysOnTop()
      window.setAlwaysOnTop(true)
      try {
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        await delay(100)
        if (foreground() !== clipClipHwnd) switchWindow(clipClipHwnd, 1)
        await waitForForeground(clipClipHwnd, 'ClipClip before granting synthetic focus')
      } finally {
        window.setAlwaysOnTop(wasAlwaysOnTop)
      }
      if (foreground() === targetHwnd) return
    }
    assert.ok(allowForeground(pid), 'ClipClip could not grant foreground access to its fixture')
    const id = await sendCommand('focus')
    await waitForEvent('focus', id)
    await waitForForeground(targetHwnd, 'External paste target')
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
    await evaluate('(() => { const field = document.querySelector("#history-search"); field.value = "Многострочная запись"; field.dispatchEvent(new Event("input", { bubbles: true })); })()')
    await waitFor(() => evaluate('document.querySelector(".record-select[aria-pressed=true]")?.id === ' + JSON.stringify('record-' + selected.id)),
      () => 'The picker did not select the expected synthetic text fixture')
  }

  function selectWithEnter() {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  }

  async function waitForPickerToHide(action = 'Enter') {
    await waitFor(() => !window.isVisible(), async () => {
      const alert = await evaluate('document.querySelector(".error-notice")?.textContent ?? document.querySelector("[role=alert]")?.textContent')
      return action + ' did not hide ClipClip' + (alert ? ': ' + alert : '')
    })
  }

  async function readTargetFocus() {
    const id = await sendCommand('focus-state')
    const { pageFocused, fieldFocused, selectionStart, selectionEnd, blurCount, navigationKeys } = await waitForEvent('focus-state', id)
    return { pageFocused, fieldFocused, selectionStart, selectionEnd, blurCount, navigationKeys }
  }

  function sendQuickKey(key, extended = false) {
    assert.equal(foreground(), targetHwnd, 'Synthetic navigation can only target the isolated fixture')
    const inputs = Buffer.alloc(inputSize * 2)
    for (const [index, release] of [0, 2].entries()) {
      const offset = index * inputSize
      inputs.writeUInt32LE(1, offset)
      inputs.writeUInt16LE(key, offset + inputOffset)
      inputs.writeUInt32LE((extended ? 1 : 0) | release, offset + inputOffset + 4)
      inputs.writeUInt32LE(TEST_KEY_MARKER, offset + inputOffset + (process.arch === 'ia32' ? 12 : 16))
    }
    assert.equal(sendInput(2, inputs, inputSize), 2, 'Could not send the synthetic navigation key')
  }

  async function clickQuickRecord() {
    const point = await evaluate(`(() => {
      const row = document.getElementById(${JSON.stringify('record-' + selected.id)})
      row?.scrollIntoView({ block: 'nearest' })
      const box = row?.getBoundingClientRect()
      return box && { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
    })()`)
    assert.ok(point, 'The expected text record must be visible in quick mode')
    const bounds = window.getContentBounds()
    const physical = screen.dipToScreenPoint({ x: bounds.x + point.x, y: bounds.y + point.y })
    const hoveredRoot = () => BigInt(getRoot(windowFromPoint(physical), 2)) // GA_ROOT
    assert.equal(foreground(), targetHwnd, 'The target must retain focus before a click')
    assert.equal(hoveredRoot(), clipClipHwnd, 'The native click must land inside the open picker')
    const original = {}
    assert.ok(getCursor(original), 'Could not get the cursor position')
    assert.ok(setCursor(physical.x, physical.y), 'Could not move to the test record')
    try {
      assert.equal(foreground(), targetHwnd)
      assert.equal(hoveredRoot(), clipClipHwnd)
      const inputs = Buffer.alloc(inputSize * 2)
      inputs.writeUInt32LE(2, inputOffset + 12) // MOUSEEVENTF_LEFTDOWN
      inputs.writeUInt32LE(4, inputSize + inputOffset + 12) // MOUSEEVENTF_LEFTUP
      assert.equal(sendInput(2, inputs, inputSize), 2, 'Could not click the synthetic picker record')
      await waitForPickerToHide('Clicking the quick-pick record')
    } finally {
      const current = {}
      if (getCursor(current) && current.x === physical.x && current.y === physical.y) setCursor(original.x, original.y)
    }
  }

  async function checkQuickPick() {
    await evaluate('window.electronAPI.setPasteOnSelect(true)')
    await waitForForeground(targetHwnd, 'External paste target before quick mode')
    let initialFocus
    await waitFor(async () => {
      initialFocus = await readTargetFocus()
      return initialFocus.pageFocused && initialFocus.fieldFocused
    }, () => 'The synthetic edit field did not gain focus before the quick-pick check')
    const assertFocusUnchanged = async () => {
      assert.equal(foreground(), targetHwnd, 'ClipClip must never take foreground focus in quick mode')
      assert.deepEqual(await readTargetFocus(), initialFocus, 'The edit field must keep its focus and selection without receiving navigation keys')
    }
    const currentSelection = () => evaluate('document.querySelector(".record-select[aria-pressed=true]")?.id')
    const openQuickPick = async () => {
      app.emit('clipclip:test:open-quick-pick')
      await waitFor(async () => window.isVisible() && await evaluate('Boolean(document.querySelector(".quick-pick .record-select[aria-pressed=true]"))'),
        () => 'The nonactivating picker did not open and select an item')
      await assertFocusUnchanged()
    }
    const pastes = async () => (await readEvents()).filter(event => event.type === 'paste')
    async function expectNextPaste(previousCount) {
      let events
      await waitFor(async () => (events = await pastes()).length > previousCount, () => 'The fixture did not receive a quick-pick paste')
      assert.equal(events.length, previousCount + 1, 'Each selection must paste once')
      const { sequence, text } = events.at(-1)
      assert.deepEqual({ sequence, text }, { sequence: copiedSequence, text: selected.data })
      await assertFocusUnchanged()
    }

    const selectedRow = 'record-' + selected.id
    const totalBefore = (await pastes()).length
    await openQuickPick()
    await waitFor(async () => await currentSelection() === selectedRow,
      async () => 'Quick Pick did not select the newest record: ' + await currentSelection())
    sendQuickKey(0x28, true) // Down
    await waitFor(async () => {
      const selection = await currentSelection()
      return selection && selection !== selectedRow
    }, () => 'Down did not select another record')
    await assertFocusUnchanged()
    sendQuickKey(0x26, true) // Up
    await waitFor(async () => await currentSelection() === selectedRow, () => 'Up did not restore the first selection')
    sendQuickKey(0x0d) // Enter
    await waitForPickerToHide()
    await expectNextPaste(totalBefore)

    await openQuickPick()
    await clickQuickRecord()
    await expectNextPaste(totalBefore + 1)

    await openQuickPick()
    sendQuickKey(0x1b) // Escape
    await waitForPickerToHide('Escape')
    await assertFocusUnchanged()
    assert.equal((await pastes()).length, totalBefore + 2, 'Escape must close without pasting')
    sendQuickKey(0x26, true)
    await waitFor(async () => (await readTargetFocus()).navigationKeys === initialFocus.navigationKeys + 1,
      () => 'The dismissed picker still intercepted navigation')
    assert.equal(foreground(), targetHwnd)
    console.log('Windows quick picker kept the edit caret and native foreground, navigated with arrows, pasted by Enter and native click, and released navigation on Escape.')
  }

  app.on('clipclip:test:paste-clipboard', writeSyntheticClipboard)
  try {
    const target = await waitForEvent('ready', undefined, 6000)
    assert.notEqual(target.pid, process.pid)
    assert.equal(target.pid, fixture.pid)
    targetHwnd = BigInt(target.hwnd)
    // Keep the rest of the smoke suite from sending input to the desktop.
    process.env.CLIPCLIP_TEST_PASTE_TARGET_PID = String(target.pid)
    if (quickOnly) await evaluate('window.electronAPI.copyItem(' + JSON.stringify(selected.id) + ')')
    await evaluate('window.electronAPI.hideWindow()')
    await focusTarget(target.pid)
    if (quickOnly) { await checkQuickPick(); return }
    await openFromTarget()
    selectWithEnter()
    await waitForPickerToHide()
    const paste = await waitForEvent('paste')
    assert.deepEqual({ sequence: paste.sequence, text: paste.text }, { sequence: copiedSequence, text: selected.data })
    await waitForForeground(targetHwnd, 'External paste target after selection')
    assert.equal((await readEvents()).filter(event => event.type === 'paste').length, 1)

    replaceBeforePaste = true
    await openFromTarget()
    selectWithEnter()
    await waitFor(() => evaluate('document.body.textContent.includes("Содержимое буфера обмена изменилось")'),
      () => 'The picker did not report that the synthetic clipboard was replaced')
    assert.equal(window.isVisible(), true)
    assert.equal((await readEvents()).filter(event => event.type === 'paste').length, 1, 'A clipboard change must prevent Ctrl+V')
    replaceBeforePaste = false

    const beforeFallback = await evaluate('window.electronAPI.getHistory()')
    const other = beforeFallback.items.find(item => item.id !== selected.id)
    assert.ok(other, 'The history needs a second item to check recency')
    await evaluate('window.electronAPI.setPaused(true)')
    const themeSource = nativeTheme.themeSource
    try {
      await evaluate('window.electronAPI.copyItem(' + JSON.stringify(other.id) + ')')
      assert.equal((await evaluate('window.electronAPI.getHistory()')).items[0].id, other.id)
      await evaluate('window.electronAPI.setPromoteCopiedRecords(false)')
      await evaluate('window.electronAPI.copyItem(' + JSON.stringify(selected.id) + ')')
      assert.equal((await evaluate('window.electronAPI.getHistory()')).items[0].id, other.id)
      await evaluate('window.electronAPI.setPromoteCopiedRecords(true)')
      // A synthetic target mismatch takes the copy-only path without sending keys.
      process.env.CLIPCLIP_TEST_PASTE_TARGET_PID = String(process.pid)
      await waitForForeground(clipClipHwnd, 'ClipClip before the copy-only scenario')
      await evaluate('document.getElementById(' + JSON.stringify('record-' + selected.id) + ').click()')
      await waitFor(() => evaluate('Boolean(document.querySelector(".error-notice.bg-warning-surface")?.textContent.includes("вставить вручную через Ctrl+V"))'),
        async () => 'The copied-only result did not show its warning: ' + await evaluate('document.querySelector(".error-notice")?.textContent ?? "No notice"'))
      const [promoted] = (await evaluate('window.electronAPI.getHistory()')).items
      assert.equal(promoted.id, selected.id, 'Copy-only fallback must promote the copied record')
      const colors = '(() => { const style = getComputedStyle(document.querySelector(".error-notice")); return [style.backgroundColor, style.color]; })()'
      for (const [theme, background, text] of [
        ['light', 'rgb(255, 241, 191)', 'rgb(101, 65, 2)'],
        ['dark', 'rgb(232, 208, 138)', 'rgb(75, 50, 0)'],
      ]) {
        nativeTheme.themeSource = theme
        await waitFor(async () => (await evaluate(colors)).join('|') === [background, text].join('|'),
          () => 'The paste warning did not use its ' + theme + ' colors')
      }
      assert.equal(await evaluate('window.electronAPI.copyItem(' + JSON.stringify(selected.id) + ')'), undefined)
      assert.equal((await evaluate('window.electronAPI.getHistory()')).items[0].createdAt, promoted.createdAt)
    } finally {
      nativeTheme.themeSource = themeSource
      process.env.CLIPCLIP_TEST_PASTE_TARGET_PID = String(target.pid)
      await evaluate('window.electronAPI.setPromoteCopiedRecords(true)')
      await evaluate('window.electronAPI.setPaused(' + beforeFallback.paused + ')')
    }

    await evaluate('window.electronAPI.setPasteOnSelect(false)')
    await evaluate('window.electronAPI.hideWindow()')
    await focusTarget(target.pid)
    await openFromTarget()
    selectWithEnter()
    await waitForPickerToHide()
    await delay(250)
    assert.equal((await readEvents()).filter(event => event.type === 'paste').length, 1, 'Disabling auto-paste must suppress Ctrl+V')
    console.log('Windows picker Enter delivered the selected synthetic text to a separate process. Replacing the clipboard and disabling auto-paste both suppressed Ctrl+V.')
    console.log('Windows copy-only fallback promoted the older record once and showed its warning colors in light and dark mode.')
    await focusTarget(target.pid)
    await checkQuickPick()
  } finally {
    app.removeListener('clipclip:test:paste-clipboard', writeSyntheticClipboard)
    delete process.env.CLIPCLIP_TEST_PASTE_TARGET_PID
    try {
      await evaluate('window.electronAPI.hideWindow()').catch(() => {})
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
