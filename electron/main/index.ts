import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, safeStorage, session, Tray, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { CHANNELS, MAX_ITEM_BYTES, UNKNOWN_SOURCE, type ClipboardSnapshot, type HistoryState } from '../../shared/clipboard'
import { ClipboardHistory, ClipboardMonitor } from './history'
import { EncryptedHistoryStorage } from './storage'
import { assetPath, isTrustedPage, requireId, requireTextRevision } from './security'
import { registerWindowsShortcut } from './windowsShortcut'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rendererRoot = path.join(root, 'dist')
const preload = path.join(root, 'dist-electron/preload/index.cjs')
const testMode = !app.isPackaged && process.env.CLIPCLIP_TEST_MODE === '1'
if (testMode && process.env.CLIPCLIP_TEST_USER_DATA) app.setPath('userData', process.env.CLIPCLIP_TEST_USER_DATA)

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }
if (process.platform === 'win32') app.setAppUserModelId('ClipClipManager2025')

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let shortcutAvailable = false
let disposeWindowShortcut: (() => void) | null = null
let persistent = false
let storageError: string | null = null
let storage: EncryptedHistoryStorage | null = null
let revision = 0
let cachedImage: { digest: string; image: NonNullable<ClipboardSnapshot['image']> } | null = null
let devServer = ''
const requestedDevServer = !app.isPackaged && process.env.VITE_DEV_SERVER_URL
if (requestedDevServer) {
  const url = new URL(requestedDevServer)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password) {
    throw new Error('Development server must use a local HTTP address')
  }
  devServer = url.href
}
const entry = devServer || 'app://clipclip/index.html'
const icon = path.join(app.isPackaged ? rendererRoot : path.join(root, 'public'), 'notepad.png')

async function readSnapshot(): Promise<ClipboardSnapshot> {
  if (testMode) {
    const fixture = process.env.CLIPCLIP_TEST_IMAGE ? nativeImage.createFromDataURL(process.env.CLIPCLIP_TEST_IMAGE) : null
    return { text: process.env.CLIPCLIP_TEST_TEXT ?? 'Проверка поиска: [ скобка, точка.\nВторая строка',
      image: fixture && !fixture.isEmpty() ? { data: fixture.toDataURL(), ...fixture.getSize() } : null }
  }
  const items = await clipboard.read()
  const textItem = items.find(item => item.types.includes('text/plain'))
  const textBlob = textItem ? await textItem.getType('text/plain') : null
  let warning: string | undefined
  if (textBlob && textBlob.size > MAX_ITEM_BYTES) warning = 'Текст больше 8 МБ пропущен.'
  const text = textBlob && !warning ? await textBlob.text() : ''
  const imageItem = items.find(item => item.types.includes('image/png') || item.types.includes('image/jpeg'))
  if (!imageItem) { cachedImage = null; return { text, image: null, warning } }
  const blob = await imageItem.getType(imageItem.types.includes('image/png') ? 'image/png' : 'image/jpeg')
  if (blob.size > MAX_ITEM_BYTES) return { text, image: null, warning: 'Изображение больше 8 МБ пропущено.' }
  const bytes = Buffer.from(await blob.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (cachedImage?.digest === digest) return { text, image: cachedImage.image, warning }
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return { text, image: null, warning: 'Изображение не удалось прочитать.' }
  const { width, height } = image.getSize()
  if (width * height > 16_000_000) return { text, image: null, warning: 'Изображение больше 16 мегапикселей пропущено.' }
  const data = image.toDataURL()
  if (Buffer.byteLength(data, 'utf8') > MAX_ITEM_BYTES) return { text, image: null, warning: 'Изображение больше 8 МБ пропущено.' }
  cachedImage = { digest, image: { data, width, height } }
  return { text, image: cachedImage.image, warning }
}

async function getSource() {
  if (testMode) return { name: 'Тест: приложение', title: '' }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const source = await Promise.race([
      import('get-windows').then(({ activeWindow }) => activeWindow({ accessibilityPermission: false, screenRecordingPermission: false })),
      new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 500) }),
    ])
    if (!source || source.owner.processId === process.pid) return UNKNOWN_SOURCE
    return { name: String(source.owner.name).slice(0, 500), title: String(source.title ?? '').slice(0, 2000) }
  } catch { return UNKNOWN_SOURCE } finally { if (timeout) clearTimeout(timeout) }
}

const history = new ClipboardHistory({ read: readSnapshot, source: getSource })
const monitor = new ClipboardMonitor(history)

function state(): HistoryState {
  return { revision, items: history.items, paused: history.paused, canUndo: history.canUndo,
    persistent, shortcutAvailable, error: storageError ?? history.error }
}

function broadcast() {
  revision++
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(CHANNELS.changed, state())
}

function updateTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть ClipClip', click: showWindow },
    { label: history.paused ? 'Продолжить запись' : 'Приостановить запись', click: () => history.setPaused(!history.paused) },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]))
}

function validateSender(event: IpcMainInvokeEvent) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents
    || event.senderFrame !== event.sender.mainFrame || !isTrustedPage(event.senderFrame.url, entry)) {
    throw new Error('Недопустимый отправитель.')
  }
}

function registerIpc() {
  const handle = (channel: string, action: (value?: unknown) => unknown) => {
    ipcMain.handle(channel, (event, value: unknown) => { validateSender(event); return action(value) })
  }
  handle(CHANNELS.getHistory, () => state())
  handle(CHANNELS.copyItem, async value => {
    const id = requireId(value)
    const item = history.items.find(candidate => candidate.id === id)
    if (!item) throw new Error('Запись уже удалена.')
    if (!testMode) {
      if (item.type === 'text') await clipboard.writeText(item.data)
      else {
        const image = nativeImage.createFromDataURL(item.data)
        if (image.isEmpty()) throw new Error('Не удалось открыть изображение.')
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
      }
    }
    history.acknowledgeClipboard({ text: item.type === 'text' ? item.data : '',
      image: item.type === 'image' ? { data: item.data, width: 1, height: 1 } : null })
  })
  handle(CHANNELS.deleteItem, value => history.delete(requireId(value)))
  handle(CHANNELS.saveTextRevision, value => {
    const { id, text } = requireTextRevision(value)
    return history.saveTextRevision(id, text)
  })
  handle(CHANNELS.undoDelete, () => history.undoDelete())
  handle(CHANNELS.setPaused, value => {
    if (typeof value !== 'boolean') throw new Error('Некорректное состояние записи.')
    history.setPaused(value)
  })
  handle(CHANNELS.hideWindow, () => {
    if (!tray && !shortcutAvailable && !testMode) win?.minimize()
    else win?.hide()
  })
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(CHANNELS.windowShown)
}

function createWindow() {
  win = new BrowserWindow({
    title: 'ClipClip Manager', width: 460, height: 560, minWidth: 380, minHeight: 420,
    show: false, icon, autoHideMenuBar: true,
    webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  const created = win
  if (process.platform === 'win32' && (!testMode || process.env.CLIPCLIP_TEST_SHORTCUT === '1')) {
    disposeWindowShortcut?.()
    try { disposeWindowShortcut = registerWindowsShortcut(created, showWindow) }
    catch { disposeWindowShortcut = null }
    shortcutAvailable = !!disposeWindowShortcut
  }
  created.setMenu(null)
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', event => { if (!isTrustedPage(event.url, entry)) event.preventDefault() })
  created.webContents.on('will-frame-navigate', event => {
    if (!event.isMainFrame || !isTrustedPage(event.url, entry)) event.preventDefault()
  })
  created.webContents.on('will-attach-webview', event => event.preventDefault())
  created.webContents.on('did-finish-load', broadcast)
  created.once('ready-to-show', () => { created.show(); created.focus() })
  created.on('close', event => {
    if (!quitting && process.platform !== 'darwin' && tray) { event.preventDefault(); created.hide() }
  })
  created.on('closed', () => {
    disposeWindowShortcut?.()
    disposeWindowShortcut = null
    if (win === created) win = null
  })
  void created.loadURL(entry).catch(() => { storageError = 'Не удалось открыть интерфейс приложения.' })
  if (!app.isPackaged && process.env.CLIPCLIP_DEVTOOLS === '1') created.webContents.openDevTools()
}

async function initialize() {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
  if (!devServer) {
    protocol.handle('app', async request => {
      const file = assetPath(request.url, rendererRoot)
      if (!file) return new Response('Forbidden', { status: 403 })
      try {
        const response = await net.fetch(pathToFileURL(file).href)
        const headers = new Headers(response.headers)
        headers.set('Content-Security-Policy', policy)
        return new Response(response.body, { status: response.status, headers })
      } catch { return new Response('Not found', { status: 404 }) }
    })
  }
  try {
    if (!testMode && safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')) {
      const useAsyncEncryption = await safeStorage.isAsyncEncryptionAvailable()
      storage = new EncryptedHistoryStorage(path.join(app.getPath('userData'), 'history.enc'), {
        encrypt: async value => useAsyncEncryption ? safeStorage.encryptStringAsync(value) : safeStorage.encryptString(value),
        decrypt: async value => useAsyncEncryption ? (await safeStorage.decryptStringAsync(value)).result : safeStorage.decryptString(value),
      })
      const restored = await storage.load()
      history.hydrate(restored.items, restored.paused)
      persistent = true
    }
  } catch {
    storageError = 'Зашифрованная история недоступна. Данные этой сессии остаются в памяти.'
    storage = null
    persistent = false
  }
  history.subscribe(() => {
    broadcast()
    updateTray()
    if (storage) void storage.save({ items: history.items, paused: history.paused }).catch(() => {
      persistent = false
      storageError = 'Не удалось сохранить историю. Данные этой сессии остаются в памяти.'
      broadcast()
    })
  })
  registerIpc()
  if (!testMode) {
    const trayImage = nativeImage.createFromPath(icon)
    if (!trayImage.isEmpty()) try {
      tray = new Tray(trayImage.resize({ width: 20, height: 20 }))
      tray.setToolTip('ClipClip — Ctrl + Alt + B')
      tray.on('click', showWindow)
      updateTray()
    } catch { tray = null }
  }
  shortcutAvailable = !testMode && process.platform !== 'win32' && globalShortcut.register('Ctrl+Alt+B', showWindow)
  createWindow()
  monitor.start()
}

void app.whenReady().then(initialize).catch(() => { console.error('ClipClip could not start.'); app.quit() })
app.on('second-instance', () => { if (app.isReady()) showWindow() })
app.on('activate', () => { if (app.isReady()) showWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit() })
app.on('before-quit', event => {
  if (quitting) return
  quitting = true
  monitor.stop()
  history.dispose()
  globalShortcut.unregisterAll()
  disposeWindowShortcut?.()
  disposeWindowShortcut = null
  if (storage) {
    event.preventDefault()
    void storage.flush().catch(() => {}).finally(() => app.quit())
  }
})
