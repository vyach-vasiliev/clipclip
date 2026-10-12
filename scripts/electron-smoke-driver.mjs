import { app, BrowserWindow, nativeImage, nativeTheme, safeStorage } from 'electron'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import '../dist-electron/main/index.js'
import { checkWindowsShortcut } from './windows-shortcut-check.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.on('uncaughtException', error => { console.error(error); app.exit(1) })
process.on('unhandledRejection', error => { console.error(error); app.exit(1) })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function screenshot(window, filename) {
  // A newly recreated/retinted window may not yet have a compositor surface.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const image = await window.webContents.capturePage()
      if (image.isEmpty()) throw new Error('Empty screenshot')
      await writeFile(path.join(process.env.CLIPCLIP_TEST_OUTPUT, filename), image.toPNG())
      return
    } catch (error) {
      if (attempt === 2) throw error
      window.webContents.invalidate()
      await delay(150)
    }
  }
}
const renderedWindow = () => new Promise(resolve => {
  app.once('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => resolve(window)))
})
async function run() {
  process.env.CLIPCLIP_TEST_TEXT = '<img src=x onerror=alert(1)> [ скобка и точка.\n' +
    'Многострочная запись сохраняет переносы строк.\n'.repeat(8)
  process.env.CLIPCLIP_TEST_IMAGE = nativeImage.createFromPath(path.join(root, 'public/notepad.png')).resize({ width: 400, height: 240 }).toDataURL()
  const firstWindow = renderedWindow()
  console.log('Launching isolated Electron fixture')

  try {
    let window = await firstWindow
    assert.deepEqual(window.getSize(), [460, 560])
    const evaluate = code => window.webContents.executeJavaScript('(async () => { ' + (code.includes(';') ? code : 'return (' + code + ')') + ' })()')
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate('Boolean(document.querySelector(".record-select"))')) break
      await delay(50)
    }
    const capabilities = await evaluate('({api: Object.keys(window.electronAPI), genericIPC: typeof window.ipcRenderer, records: document.querySelectorAll(".record-select").length})')
    assert.equal(capabilities.genericIPC, 'undefined')
    assert.equal(capabilities.records, 2)
    assert.deepEqual(capabilities.api.sort(), ['copyItem', 'saveTextRevision', 'deleteItem', 'getHistory', 'hideWindow', 'onHistoryChanged', 'onWindowShown', 'setPaused', 'undoDelete'].sort())
    assert.equal(window.webContents.isDevToolsOpened(), false)
    if (process.platform === 'win32' && process.env.CLIPCLIP_TEST_SHORTCUT === '1') {
      assert.equal(await evaluate('(await window.electronAPI.getHistory()).shortcutAvailable'), true)
      await checkWindowsShortcut(window)
    }
    if (process.platform === 'win32') {
      const { activeWindow } = await import('get-windows')
      await activeWindow({ accessibilityPermission: false, screenRecordingPermission: false })
      assert.equal(safeStorage.isEncryptionAvailable(), true)
      const useAsync = await safeStorage.isAsyncEncryptionAvailable()
      const encrypted = useAsync ? await safeStorage.encryptStringAsync('fixture-secret') : safeStorage.encryptString('fixture-secret')
      assert.equal(encrypted.includes(Buffer.from('fixture-secret')), false)
      const decrypted = useAsync ? (await safeStorage.decryptStringAsync(encrypted)).result : safeStorage.decryptString(encrypted)
      assert.equal(decrypted, 'fixture-secret')
    }
    assert.equal(await evaluate('document.querySelectorAll(".text-preview img").length'), 0)

    await evaluate('document.querySelector("input").value = "["; document.querySelector("input").dispatchEvent(new Event("input", {bubbles:true}))')
    await delay(100)
    assert.equal(await evaluate('document.querySelector("mark")?.textContent'), '[')
    await evaluate('document.querySelector("input").dispatchEvent(new KeyboardEvent("keydown", {key:"Delete",bubbles:true}))')
    assert.equal(await evaluate('(await window.electronAPI.getHistory()).items.length'), 2)

    await evaluate('document.querySelector("input").value="not-found-fixture"; document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))')
    await delay(50)
    await evaluate('document.querySelector("input").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))')
    await evaluate('document.querySelector("input").value=""; document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))')
    await delay(50)
    assert.equal(await evaluate('document.querySelectorAll(".record-select[aria-pressed=true]").length'), 1)

    assert.equal(await evaluate('window.electronAPI.copyItem({invalid:true}).then(()=>false,()=>true)'), true)
    const id = await evaluate('(await window.electronAPI.getHistory()).items[0].id')
    await evaluate('window.electronAPI.deleteItem(' + JSON.stringify(id) + ')')
    assert.equal(await evaluate('(await window.electronAPI.getHistory()).items.length'), 1)
    await evaluate('window.electronAPI.undoDelete()')
    assert.equal(await evaluate('(await window.electronAPI.getHistory()).items.length'), 2)
    await evaluate('window.electronAPI.setPaused(true)')
    assert.equal(await evaluate('(await window.electronAPI.getHistory()).paused'), true)
    await evaluate('window.electronAPI.setPaused(false)')

    // Recreate the window on every OS to exercise the macOS lifecycle path.
    app.removeAllListeners('window-all-closed')
    const reopened = renderedWindow()
    window.destroy()
    app.emit('activate')
    window = await reopened
    await delay(200)
    assert.equal(await evaluate('(await window.electronAPI.getHistory()).items.length'), 2)
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    if (process.platform === 'win32' && process.env.CLIPCLIP_TEST_SHORTCUT === '1') {
      assert.equal(await evaluate('(await window.electronAPI.getHistory()).shortcutAvailable'), true)
    }
    await evaluate('location.href="app://other/index.html"')
    await delay(100)
    assert.ok(window.webContents.getURL().startsWith(process.env.VITE_DEV_SERVER_URL || 'app://clipclip/index.html'))

    // Fill the compact list without reading or changing the system clipboard.
    for (let record = 0; record < 8; record++) {
      process.env.CLIPCLIP_TEST_TEXT = 'Запись ' + (record + 1) + ': заметка для быстрого выбора.\nВторая строка с описанием.'
      for (let attempt = 0; attempt < 30; attempt++) {
        const captured = await evaluate('(await window.electronAPI.getHistory()).items.some(item => item.data.startsWith(' + JSON.stringify('Запись ' + (record + 1) + ':') + '))')
        if (captured) break
        await delay(50)
      }
    }
    app.emit('activate')
    await delay(100)
    assert.equal(await evaluate('(await window.electronAPI.getHistory()).items.length'), 10)
    assert.equal(await evaluate('document.querySelector(".history-list").scrollHeight > document.querySelector(".history-list").clientHeight'), true)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".history-list"), "::-webkit-scrollbar").width'), '7px')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".history-list"), "::-webkit-scrollbar-button").display'), 'none')
    await evaluate('document.querySelector(".preview-button").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector("dialog").open'), true)
    await screenshot(window, 'preview.png')
    const originalText = await evaluate('document.querySelector(".preview-content pre").textContent')
    await evaluate('document.querySelector(".edit-toggle").click()')
    await delay(50)
    await evaluate('document.querySelector("textarea").value = "Промежуточная версия"; document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))')
    await delay(850)
    assert.equal(await evaluate('(await window.electronAPI.getHistory()).items[0].data'), 'Промежуточная версия')
    await evaluate('document.querySelector("textarea").value = "Последний вариант"; document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))')
    await evaluate('document.querySelector(".reset-edit").click()')
    await delay(100)
    const versions = await evaluate('(await window.electronAPI.getHistory()).items.map(item => item.data)')
    assert.equal(versions[0], originalText)
    assert.ok(versions.includes('Промежуточная версия'))
    assert.ok(versions.includes('Последний вариант'))
    await screenshot(window, 'editor.png')
    await evaluate('document.querySelector("textarea").value = "Версия при закрытии"; document.querySelector("textarea").dispatchEvent(new Event("input",{bubbles:true}))')
    await evaluate('document.querySelector(".close-preview").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector("dialog").open'), false)
    assert.equal(await evaluate('(await window.electronAPI.getHistory()).items[0].data'), 'Версия при закрытии')

    nativeTheme.themeSource = 'light'
    await delay(150)
    await screenshot(window, 'light.png')
    nativeTheme.themeSource = 'dark'
    await delay(150)
    await screenshot(window, 'dark.png')
    window.setSize(380, 420)
    await delay(150)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true)
    assert.equal(await evaluate('document.documentElement.scrollHeight <= window.innerHeight'), true)
    assert.equal(await evaluate('document.querySelector(".history-list").clientHeight >= 84'), true)
    await screenshot(window, 'compact.png')

    for (let step = 0; step < 9; step++) {
      await evaluate('document.querySelector("input").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))')
    }
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".history-list").scrollTop > 0'), true)
    app.emit('activate')
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".history-list").scrollTop'), 0)
    assert.equal(await evaluate('document.activeElement === document.querySelector("input")'), true)

    await evaluate('document.querySelector(".record-select").click()')
    await delay(100)
    assert.equal(window.isVisible(), false)
    console.log('Electron smoke test passed: isolated clipboard, IPC, search, keyboard, window lifecycle, light/dark and compact layout.')
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}
// Electron emits ready after evaluating the ESM entrypoint; do not await it at top level.
void run().catch(error => { console.error(error); app.exit(1) })
