import { app, BrowserWindow, ClipboardItem, nativeImage, nativeTheme, safeStorage } from 'electron'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import '../dist-electron/main/index.js'
import { checkWindowsShortcut } from './windows-shortcut-check.mjs'
import { checkWindowsClipboardSource } from './windows-clipboard-source-check.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.on('uncaughtException', error => { console.error(error); app.exit(1) })
process.on('unhandledRejection', error => { console.error(error); app.exit(1) })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let fixtureTray
const taskbarStates = new WeakMap()
app.on('clipclip:test:tray-created', tray => { fixtureTray = tray })
app.on('browser-window-created', (_event, created) => {
  const setSkipTaskbar = created.setSkipTaskbar.bind(created)
  created.setSkipTaskbar = skip => { taskbarStates.set(created, skip); setSkipTaskbar(skip) }
})
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
  app.once('browser-window-created', (_event, window) => {
    const loaded = new Promise(done => window.webContents.once('did-finish-load', done))
    const ready = new Promise(done => window.once('ready-to-show', done))
    void Promise.all([loaded, ready]).then(() => resolve(window))
  })
})
async function run() {
  process.env.CLIPCLIP_TEST_TEXT = '<img src=x onerror=alert(1)> [ скобка и точка.\n' +
    'Многострочная запись сохраняет переносы строк.\n'.repeat(8)
  process.env.CLIPCLIP_TEST_IMAGE = nativeImage.createFromPath(path.join(root, 'public/notepad.png')).resize({ width: 1600, height: 960 }).toDataURL()
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
    assert.deepEqual(capabilities.api.sort(), ['copyItem', 'saveTextRevision', 'deleteItem', 'getHistory', 'hideWindow', 'setPreviewFullscreen', 'onPreviewFullscreenChanged', 'onHistoryChanged', 'onWindowShown', 'setPaused', 'undoDelete'].sort())
    assert.equal(window.webContents.isDevToolsOpened(), false)
    window.show()
    window.focus()
    await delay(100)
    assert.equal(await evaluate('document.activeElement === document.querySelector("input")'), true)
    await evaluate('document.querySelector(".preview-button").focus()')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'f' })
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'f' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'f' })
    await delay(100)
    assert.equal(await evaluate('document.querySelector("input").value'), 'f')
    assert.equal(await evaluate('document.activeElement === document.querySelector("input")'), true)
    assert.equal(await evaluate('document.querySelector("dialog").open'), false)
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await delay(50)
    assert.equal(await evaluate('document.querySelector("input").value'), '')
    assert.equal(window.isVisible(), true)
    if (process.platform === 'win32' && process.env.CLIPCLIP_TEST_SHORTCUT === '1') {
      assert.equal(await evaluate('(await window.electronAPI.getHistory()).shortcutAvailable'), true)
      await checkWindowsShortcut(window)
    }
    if (process.platform === 'win32') {
      await checkWindowsClipboardSource(window, root)
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

    assert.equal(await evaluate('window.electronAPI.setPreviewFullscreen("true").then(()=>false,()=>true)'), true)
    const waitFullscreen = async expected => {
      for (let attempt = 0; attempt < 60 && window.isFullScreen() !== expected; attempt++) await delay(50)
      assert.equal(window.isFullScreen(), expected)
      await delay(150)
    }
    const originalWindowSize = window.getSize()
    if (process.platform === 'win32') {
      assert.equal(await evaluate('window.innerHeight'), originalWindowSize[1])
      assert.equal(await evaluate('getComputedStyle(document.querySelector("header")).getPropertyValue("-webkit-app-region")'), 'drag')
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".hide-window")).getPropertyValue("-webkit-app-region")'), 'no-drag')
    }
    const checkFullscreenControls = async () => {
      const dimensions = await evaluate('({width: window.innerWidth, height: window.innerHeight, dialog: document.querySelector("dialog").getBoundingClientRect().toJSON(), close: document.querySelector(".close-preview").getBoundingClientRect().toJSON()})')
      assert.ok(Math.abs(dimensions.dialog.left) < 2 && Math.abs(dimensions.dialog.top) < 2, JSON.stringify(dimensions))
      assert.ok(dimensions.dialog.width <= dimensions.width + 1, JSON.stringify(dimensions))
      assert.ok(dimensions.close.right <= dimensions.width + 1 && dimensions.close.top >= 0, JSON.stringify(dimensions))
    }
    const imageId = await evaluate('(await window.electronAPI.getHistory()).items.find(item => item.type === "image").id')
    await evaluate('document.querySelector("input").value="#pic"; document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))')
    await delay(50)
    assert.equal(await evaluate('document.querySelectorAll(".record-select").length'), 1)
    assert.equal(await evaluate('document.querySelector(".suggestions .tag-badge").textContent.trim()'), 'Изображение')
    await evaluate('document.querySelector("input").value=""; document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))')
    window.show()
    window.focus()
    await evaluate('document.getElementById(' + JSON.stringify('record-' + imageId) + ').closest("article").querySelector(".preview-button").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".zoom-image").naturalWidth'), 1600)
    assert.equal(await evaluate('document.querySelector(".image-viewport").scrollWidth <= document.querySelector(".image-viewport").clientWidth + 1'), true)
    const compactPreview = await evaluate('({width: innerWidth, height: innerHeight, dialog: document.querySelector("dialog").getBoundingClientRect().toJSON(), previous: document.querySelector(".preview-previous").getBoundingClientRect().toJSON(), next: document.querySelector(".preview-next").getBoundingClientRect().toJSON(), zoom: document.querySelector(".zoom-controls").getBoundingClientRect().toJSON(), fit: document.querySelector(".zoom-fit").getBoundingClientRect().toJSON(), hit: document.querySelector(".zoom-in").getBoundingClientRect().toJSON(), circle: document.querySelector(".zoom-in > span").getBoundingClientRect().toJSON()})')
    assert.equal(compactPreview.dialog.width, compactPreview.width - 16)
    assert.equal(compactPreview.dialog.height, compactPreview.height - 16)
    assert.equal(compactPreview.zoom.width, 140)
    assert.equal(compactPreview.hit.width, 40)
    assert.equal(compactPreview.circle.width, 32)
    assert.equal(compactPreview.previous.top, compactPreview.fit.top)
    assert.equal(compactPreview.next.top, compactPreview.fit.top)
    assert.ok(compactPreview.previous.right <= compactPreview.zoom.left && compactPreview.fit.right <= compactPreview.next.left)
    // Changing optional metadata must not shift the controls above it.
    await evaluate('const metadata = document.querySelector(".preview-metadata"); metadata.style.display = "none"; const title = document.createElement("p"); title.className = "fixture-preview-source shrink-0"; title.textContent = "Synthetic source window"; metadata.after(title)')
    assert.equal(await evaluate('document.querySelector(".preview-previous").getBoundingClientRect().top'), compactPreview.previous.top)
    assert.equal(await evaluate('document.querySelector(".preview-next").getBoundingClientRect().top'), compactPreview.next.top)
    await evaluate('document.querySelector(".fixture-preview-source").remove(); document.querySelector(".preview-metadata").style.display = ""')
    await delay(150)
    assert.equal(await evaluate('document.querySelector("dialog").textContent.includes("Ctrl + колесо — масштаб")'), false)
    const fitWidth = await evaluate('document.querySelector(".zoom-image").getBoundingClientRect().width')
    const intermediateWidth = await evaluate('document.querySelector(".zoom-in").click(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return document.querySelector(".zoom-image").getBoundingClientRect().width')
    assert.ok(intermediateWidth > fitWidth && intermediateWidth <= fitWidth * 1.35 + 1, JSON.stringify({ fitWidth, intermediateWidth }))
    assert.equal(await evaluate('document.querySelector(".image-viewport").dispatchEvent(new WheelEvent("wheel", {ctrlKey:true,deltaY:-100,cancelable:true}))'), false)
    assert.equal(window.webContents.getZoomFactor(), 1)
    await evaluate('document.querySelector(".zoom-percent").click()')
    await delay(450)
    assert.equal(await evaluate('Math.round(document.querySelector(".zoom-image").getBoundingClientRect().width)'), 1600)
    const pinch = await evaluate(`
      const viewport = document.querySelector('.image-viewport');
      const image = document.querySelector('.zoom-image');
      const area = viewport.getBoundingClientRect();
      const point = { x: area.left + viewport.clientWidth / 2, y: area.top + viewport.clientHeight / 2 };
      const before = image.getBoundingClientRect();
      const pivot = { x: (point.x - before.left) / before.width, y: (point.y - before.top) / before.height };
      const samples = [];
      for (let frame = 0; frame < 10; frame++) {
        for (let event = 0; event < 4; event++) viewport.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -.75, deltaMode: 0, clientX: point.x, clientY: point.y, cancelable: true }));
        await new Promise(requestAnimationFrame);
        const rect = image.getBoundingClientRect();
        samples.push({ width: rect.width, errorX: Math.abs(point.x - rect.left - pivot.x * rect.width), errorY: Math.abs(point.y - rect.top - pivot.y * rect.height) });
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      return { samples, finalWidth: image.getBoundingClientRect().width };
    `)
    let previousPinchWidth = 1600
    for (const sample of pinch.samples) {
      assert.ok(sample.width >= previousPinchWidth && sample.width / previousPinchWidth < 1.02, JSON.stringify(sample))
      assert.ok(sample.errorX <= 1.5 && sample.errorY <= 1.5, JSON.stringify(sample))
      previousPinchWidth = sample.width
    }
    assert.ok(Math.abs(pinch.finalWidth - 1600 * Math.exp(30 * .0025)) < .5)
    assert.equal(window.webContents.getZoomFactor(), 1)
    await evaluate('document.querySelector(".zoom-percent").click()')
    await delay(150)
    await evaluate('document.querySelector(".image-viewport").scrollLeft = 100; document.querySelector(".image-viewport").scrollTop = 100')
    const viewportRect = await evaluate('document.querySelector(".image-viewport").getBoundingClientRect().toJSON()')
    const dragPoint = { x: Math.round(viewportRect.left + viewportRect.width / 2), y: Math.round(viewportRect.top + viewportRect.height / 2) }
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...dragPoint })
    await delay(50)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".image-viewport")).cursor'), 'grabbing')
    window.webContents.sendInputEvent({ type: 'mouseMove', x: dragPoint.x - 40, y: dragPoint.y - 30, modifiers: ['leftButtonDown'] })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: dragPoint.x - 40, y: dragPoint.y - 30 })
    await delay(50)
    const dragged = await evaluate('({left: document.querySelector(".image-viewport").scrollLeft, top: document.querySelector(".image-viewport").scrollTop, cursor: getComputedStyle(document.querySelector(".image-viewport")).cursor})')
    assert.equal(dragged.left, 140)
    assert.equal(dragged.top, 130)
    assert.equal(dragged.cursor, 'grab')
    await evaluate('document.querySelector(".fullscreen-toggle").click()')
    await waitFullscreen(true)
    assert.equal(await evaluate('document.querySelector("dialog").classList.contains("is-fullscreen")'), true)
    await checkFullscreenControls()
    assert.equal(await evaluate('Math.abs(document.querySelector("dialog").getBoundingClientRect().height - window.innerHeight) < 2'), true)
    await screenshot(window, 'fullscreen-image.png')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".zoom-image").naturalWidth'), 1600)
    assert.equal(await evaluate('document.querySelector(".preview-position").textContent'), '(1/1)')
    assert.equal(await evaluate('document.querySelector(".preview-previous").disabled && document.querySelector(".preview-next").disabled'), true)
    process.env.CLIPCLIP_TEST_IMAGE = nativeImage.createFromPath(path.join(root, 'public/notepad.png')).resize({ width: 800, height: 600 }).toDataURL()
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await evaluate('(await window.electronAPI.getHistory()).items.filter(item => item.type === "image").length === 2')) break
      await delay(100)
    }
    assert.equal(await evaluate('document.querySelector(".preview-position").textContent'), '(2/2)')
    const fullscreenPreviewSize = await evaluate('({width: document.querySelector("dialog").clientWidth, height: document.querySelector("dialog").clientHeight})')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' })
    await delay(150)
    assert.equal(await evaluate('document.querySelector(".zoom-image").naturalWidth'), 800)
    assert.equal(await evaluate('document.querySelector(".preview-position").textContent'), '(1/2)')
    assert.deepEqual(await evaluate('({width: document.querySelector("dialog").clientWidth, height: document.querySelector("dialog").clientHeight})'), fullscreenPreviewSize)
    assert.equal(await evaluate('document.querySelector(".preview-metadata").textContent.includes("Тест: приложение")'), true)
    assert.equal(window.isFullScreen(), true)
    await evaluate('document.querySelector(".preview-next").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".zoom-image").naturalWidth'), 1600)
    assert.equal(await evaluate('document.querySelector(".preview-position").textContent'), '(2/2)')
    assert.equal(await evaluate('document.querySelector(".preview-next").disabled'), true)
    assert.deepEqual(await evaluate('({width: document.querySelector("dialog").clientWidth, height: document.querySelector("dialog").clientHeight})'), fullscreenPreviewSize)
    assert.equal(await evaluate('document.querySelector(".zoom-in").disabled'), false)
    assert.equal(window.isFullScreen(), true)
    await evaluate('document.querySelector(".zoom-fit").click()')
    await evaluate('document.querySelector(".close-preview").click()')
    await waitFullscreen(false)
    assert.deepEqual(window.getSize(), originalWindowSize)
    // Reopening a cached image must still enable zoom controls.
    await evaluate('document.getElementById(' + JSON.stringify('record-' + imageId) + ').closest("article").querySelector(".preview-button").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".zoom-in").disabled'), false)
    await evaluate('document.querySelector(".preview-previous").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".zoom-image").naturalWidth'), 800)
    assert.equal(await evaluate('document.querySelector(".preview-position").textContent'), '(1/2)')
    assert.deepEqual(await evaluate('({width: document.querySelector("dialog").getBoundingClientRect().width, height: document.querySelector("dialog").getBoundingClientRect().height})'), { width: compactPreview.dialog.width, height: compactPreview.dialog.height })
    await evaluate('document.querySelector(".preview-next").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".zoom-image").naturalWidth'), 1600)
    assert.deepEqual(await evaluate('({width: document.querySelector("dialog").getBoundingClientRect().width, height: document.querySelector("dialog").getBoundingClientRect().height})'), { width: compactPreview.dialog.width, height: compactPreview.dialog.height })
    nativeTheme.themeSource = 'dark'
    await delay(100)
    assert.equal(await evaluate('getComputedStyle(document.querySelector("dialog"), "::backdrop").backgroundColor'), 'rgb(17, 23, 35)')
    assert.equal(await evaluate('getComputedStyle(document.querySelector("dialog")).boxShadow'), 'none')
    await screenshot(window, 'image-zoom-dark.png')
    nativeTheme.themeSource = 'light'
    await delay(100)
    assert.equal(await evaluate('getComputedStyle(document.querySelector("dialog"), "::backdrop").backgroundColor'), 'rgb(244, 246, 250)')
    assert.equal(await evaluate('getComputedStyle(document.querySelector("dialog")).boxShadow'), 'none')
    await screenshot(window, 'image-zoom.png')
    await evaluate('document.querySelector(".fullscreen-toggle").click()')
    await waitFullscreen(true)
    await evaluate('Array.from(document.querySelectorAll(".preview-tag")).find(button => button.textContent.trim() === "Изображение").click()')
    await waitFullscreen(false)
    await delay(50)
    assert.equal(await evaluate('document.querySelector("dialog").open'), false)
    assert.equal(await evaluate('document.querySelector(".filter-row .tag-badge").textContent.trim()'), 'Изображение')
    assert.equal(await evaluate('document.querySelectorAll(".record-select").length'), 2)
    assert.equal(await evaluate('document.activeElement === document.querySelector("input")'), true)
    assert.equal(window.isVisible(), true)
    await screenshot(window, 'preview-tag-search.png')
    await evaluate('document.querySelector(".filter-row .tag-badge").click()')
    await delay(50)

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
    await evaluate('document.querySelector("input").value="#"; document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))')
    await delay(100)
    assert.ok(await evaluate('document.querySelectorAll(".suggestions .tag-badge").length > 0'))
    nativeTheme.themeSource = 'light'
    await delay(100)
    await screenshot(window, 'badges-light.png')
    nativeTheme.themeSource = 'dark'
    await delay(100)
    await screenshot(window, 'badges-dark.png')
    await evaluate('document.querySelector("input").value=""; document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))')
    nativeTheme.themeSource = 'light'
    await delay(100)
    await evaluate('document.querySelector(".preview-button").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector("dialog").open'), true)
    await evaluate('document.querySelector("dialog").dispatchEvent(new KeyboardEvent("keydown", {key:"а",code:"KeyF",ctrlKey:true,bubbles:true,cancelable:true}))')
    await waitFullscreen(true)
    await checkFullscreenControls()
    await screenshot(window, 'fullscreen-text.png')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    await waitFullscreen(false)
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape', modifiers: ['isautorepeat'] })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await delay(100)
    assert.equal(window.isVisible(), true)
    assert.equal(await evaluate('document.querySelector("dialog").open'), true)
    await screenshot(window, 'preview.png')
    const originalText = await evaluate('document.querySelector(".preview-content pre").textContent')
    await evaluate('document.querySelector(".edit-toggle").click()')
    await delay(50)
    await evaluate('document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown", {key:"f",code:"KeyF",ctrlKey:true,bubbles:true,cancelable:true}))')
    await waitFullscreen(true)
    await checkFullscreenControls()
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
    await waitFullscreen(false)
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

    // Document fixtures never read file contents or change the system clipboard.
    const waitRecord = async predicate => {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await evaluate('(await window.electronAPI.getHistory()).items.some(' + predicate + ')')) return
        await delay(100)
      }
      throw new Error('Synthetic classified record was not captured')
    }
    process.env.CLIPCLIP_TEST_SOURCE = 'Microsoft Word'
    process.env.CLIPCLIP_TEST_TEXT = 'Synthetic document paragraph'
    delete process.env.CLIPCLIP_TEST_IMAGE
    await waitRecord('item => item.type === "document" && item.data === "Synthetic document paragraph"')
    const fileUris = ['file:///C:/Fixture/Report%20one.pdf', 'file:///C:/Fixture/Table.xlsx']
    const payload = new ClipboardItem({ 'text/uri-list': new Blob([fileUris.join('\r\n')], { type: 'text/uri-list' }) })
    assert.equal(await (await payload.getType('text/uri-list')).text(), fileUris.join('\r\n'))
    process.env.CLIPCLIP_TEST_FILES = JSON.stringify(fileUris)
    process.env.CLIPCLIP_TEST_TEXT = ''
    await waitRecord('item => item.type === "document" && item.fileUris?.length === 2')
    app.emit('activate'); await delay(100)
    await evaluate('document.querySelector(".preview-button").click()')
    await delay(100)
    assert.equal(await evaluate('document.querySelector(".edit-toggle") === null'), true)
    assert.equal(await evaluate('document.querySelector(".preview-content pre").textContent.includes("Report one.pdf")'), true)
    await screenshot(window, 'document-preview.png')
    await evaluate('document.querySelector(".close-preview").click()')
    delete process.env.CLIPCLIP_TEST_FILES
    process.env.CLIPCLIP_TEST_TEXT = 'https://example.test/clipboard'
    await waitRecord('item => item.type === "link" && item.data === "https://example.test/clipboard"')
    await evaluate('document.querySelector("input").value="#url"; document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))')
    await delay(100)
    assert.equal(await evaluate('document.querySelectorAll(".record-select").length'), 1)
    assert.equal(await evaluate('document.querySelector(".suggestions .tag-badge").textContent.trim()'), 'Ссылка')
    await screenshot(window, 'link-search.png')
    await evaluate('document.querySelector("input").value=""; document.querySelector("input").dispatchEvent(new Event("input",{bubbles:true}))')
    nativeTheme.themeSource = 'light'
    await delay(100)
    const recordBounds = await evaluate('document.querySelector(".clipboard-record").getBoundingClientRect().toJSON()')
    await evaluate('document.querySelector(".record-select").focus()')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".record-select")).backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".clipboard-record")).backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.deepEqual(await evaluate('document.querySelector(".clipboard-record").getBoundingClientRect().toJSON()'), recordBounds)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".clipboard-record")).outlineWidth'), '1px')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".clipboard-record")).outlineStyle'), 'solid')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".record-select")).outlineStyle'), 'none')
    await screenshot(window, 'full-card-highlight.png')
    nativeTheme.themeSource = 'dark'
    await delay(100)
    await screenshot(window, 'focused-card-dark.png')
    nativeTheme.themeSource = 'light'
    await delay(100)
    await evaluate('document.querySelector("input").focus()')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".clipboard-record")).outlineStyle'), 'none')

    await evaluate('document.querySelector(".record-select").click()')
    await delay(100)
    assert.equal(window.isVisible(), false)
    app.emit('activate')
    await delay(100)
    const hideButton = await evaluate('document.querySelector(".hide-window").getBoundingClientRect().toJSON()')
    const point = { x: Math.round(hideButton.left + hideButton.width / 2), y: Math.round(hideButton.top + hideButton.height / 2) }
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    await delay(100)
    assert.equal(window.isVisible(), false)
    if (process.platform === 'win32') {
      assert.ok(fixtureTray && !fixtureTray.isDestroyed())
      assert.equal(taskbarStates.get(window), true)
      const waitState = async predicate => {
        for (let attempt = 0; attempt < 60 && !predicate(); attempt++) await delay(50)
        assert.equal(predicate(), true)
      }
      fixtureTray.emit('click')
      await waitState(() => window.isVisible() && !window.isMinimized())
      assert.equal(taskbarStates.get(window), false)
      await delay(50)
      assert.equal(await evaluate('document.activeElement === document.querySelector("input")'), true)
      fixtureTray.emit('click')
      await waitState(() => !window.isVisible())
      assert.equal(taskbarStates.get(window), true)
      assert.equal(fixtureTray.isDestroyed(), false)
      fixtureTray.emit('click')
      await waitState(() => window.isVisible())
      window.minimize()
      await waitState(() => window.isMinimized() && taskbarStates.get(window) === true)
      fixtureTray.emit('click')
      await waitState(() => window.isVisible() && !window.isMinimized())
      assert.equal(taskbarStates.get(window), false)
      const compactSize = window.getSize()
      await evaluate('document.querySelector(".preview-button").click()')
      await delay(50)
      await evaluate('window.electronAPI.setPreviewFullscreen(true)')
      fixtureTray.emit('click')
      await waitState(() => !window.isVisible() && !window.isFullScreen())
      assert.equal(taskbarStates.get(window), true)
      assert.deepEqual(window.getSize(), compactSize)
      fixtureTray.emit('click')
      await waitState(() => window.isVisible())
      await delay(100)
      fixtureTray.emit('click'); fixtureTray.emit('click')
      await delay(150)
      assert.equal(window.isVisible(), true)
      assert.equal(taskbarStates.get(window), false)
      assert.equal(fixtureTray.isDestroyed(), false)
    }
    console.log('Electron smoke test passed: isolated clipboard, documents/links, bilingual tags, full-card highlight, IPC, same-type preview navigation, fixed preview dimensions, compact zoom, mouse panning, fullscreen and window controls.')
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}
// Electron emits ready after evaluating the ESM entrypoint; do not await it at top level.
void run().catch(error => { console.error(error); app.exit(1) })
