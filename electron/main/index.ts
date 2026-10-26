import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, safeStorage, session, Tray, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { CHANNELS, MAX_ITEM_BYTES, UNKNOWN_SOURCE, isFileUriList, type ClipboardSnapshot, type HistoryState } from '../../shared/clipboard'
import { ClipboardHistory, ClipboardMonitor } from './history'
import { EncryptedHistoryStorage } from './storage'
import { assetPath, isTrustedPage, requireId, requireTextRevision } from './security'
import { registerWindowsShortcut } from './windowsShortcut'
import { getWindowsClipboardOwnerReader } from './windowsClipboardSource'

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
let visibilityGeneration = 0
let trayTransition: Promise<void> = Promise.resolve()
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
      image: fixture && !fixture.isEmpty() ? { data: fixture.toDataURL(), ...fixture.getSize() } : null,
      fileUris: process.env.CLIPCLIP_TEST_FILES ? JSON.parse(process.env.CLIPCLIP_TEST_FILES) : undefined }
  }
  // Capture the owner before asynchronous clipboard decoding can outlive its window.
  const ownerReader = getWindowsClipboardOwnerReader()
  const ownerCapture = ownerReader?.capture()
  const items = await clipboard.read()
  const textItem = items.find(item => item.types.includes('text/plain'))
  const textBlob = textItem ? await textItem.getType('text/plain') : null
  let warning: string | undefined
  if (textBlob && textBlob.size > MAX_ITEM_BYTES) warning = 'Текст больше 8 МБ пропущен.'
  const text = textBlob && !warning ? await textBlob.text() : ''
  const fileItem = items.find(item => item.types.includes('text/uri-list'))
  let fileUris: string[] | undefined
  if (fileItem) {
    const blob = await fileItem.getType('text/uri-list')
    if (blob.size > MAX_ITEM_BYTES) warning = 'Список файлов больше 8 МБ пропущен.'
    else {
      const uris = (await blob.text()).split(/\r?\n/).map(uri => uri.trim()).filter(uri => uri && !uri.startsWith('#'))
      if (isFileUriList(uris)) fileUris = uris.map(uri => new URL(uri).href)
      else warning = 'Список файлов не удалось прочитать.'
    }
  }
  const imageItem = items.find(item => item.types.includes('image/png') || item.types.includes('image/jpeg'))
  if (!imageItem) { cachedImage = null; return { text, image: null, fileUris, warning } }
  const blob = await imageItem.getType(imageItem.types.includes('image/png') ? 'image/png' : 'image/jpeg')
  if (blob.size > MAX_ITEM_BYTES) return { text, image: null, fileUris, warning: 'Изображение больше 8 МБ пропущено.' }
  const bytes = Buffer.from(await blob.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (cachedImage?.digest === digest) return { text, image: cachedImage.image, imageSource: ownerReader?.resolve(ownerCapture), fileUris, warning }
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return { text, image: null, fileUris, warning: 'Изображение не удалось прочитать.' }
  const { width, height } = image.getSize()
  if (width * height > 16_000_000) return { text, image: null, fileUris, warning: 'Изображение больше 16 мегапикселей пропущено.' }
  const data = image.toDataURL()
  if (Buffer.byteLength(data, 'utf8') > MAX_ITEM_BYTES) return { text, image: null, fileUris, warning: 'Изображение больше 8 МБ пропущено.' }
  cachedImage = { digest, image: { data, width, height } }
  return { text, image: cachedImage.image, imageSource: ownerReader?.resolve(ownerCapture), fileUris, warning }
}

async function getSource() {
  if (testMode) return { name: process.env.CLIPCLIP_TEST_SOURCE ?? 'Тест: приложение', title: '' }
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

async function setWindowFullscreen(fullscreen: boolean): Promise<void> {
  const window = win
  if (!window || window.isDestroyed()) throw new Error('Окно недоступно.')
  if (window.isFullScreen() === fullscreen) return
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      if (fullscreen) window.removeListener('enter-full-screen', changed)
      else window.removeListener('leave-full-screen', changed)
      window.removeListener('closed', closed)
      if (error) reject(error)
      else resolve()
    }
    const changed = () => finish()
    const closed = () => finish(new Error('Окно закрыто.'))
    const timer = setTimeout(() => finish(window.isDestroyed() || window.isFullScreen() !== fullscreen
      ? new Error('Полноэкранный режим недоступен.') : undefined), 3000)
    if (fullscreen) window.once('enter-full-screen', changed)
    else window.once('leave-full-screen', changed)
    window.once('closed', closed)
    try { window.setFullScreen(fullscreen) } catch { finish(new Error('Полноэкранный режим недоступен.')) }
  })
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
      if (item.fileUris) await clipboard.write([new ClipboardItem({ 'text/uri-list': new Blob([item.fileUris.join('\r\n')], { type: 'text/uri-list' }) })])
      else if (item.type !== 'image') await clipboard.writeText(item.data)
      else {
        const image = nativeImage.createFromDataURL(item.data)
        if (image.isEmpty()) throw new Error('Не удалось открыть изображение.')
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
      }
    }
    history.acknowledgeClipboard({ text: item.type !== 'image' && !item.fileUris ? item.data : '', fileUris: item.fileUris,
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
  handle(CHANNELS.setPreviewFullscreen, value => {
    if (typeof value !== 'boolean') throw new Error('Некорректный полноэкранный режим.')
    return setWindowFullscreen(value)
  })
  handle(CHANNELS.hideWindow, hideWindow)
}

async function hideWindow() {
  const window = win
  if (!window || window.isDestroyed()) return
  const generation = ++visibilityGeneration
  await setWindowFullscreen(false)
  if (generation !== visibilityGeneration || window.isDestroyed() || window !== win) return
  if (!tray && !shortcutAvailable && !testMode) window.minimize()
  else window.hide()
}
function toggleTrayWindow() {
  trayTransition = trayTransition.then(async () => {
    if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) await hideWindow()
    else showWindow()
  }).catch(() => { if (!quitting) showWindow() })
}
function showWindow() {
  visibilityGeneration++
  if (!win || win.isDestroyed()) createWindow()
  if (!win) return
  if (process.platform === 'win32') win.setSkipTaskbar(false)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(CHANNELS.windowShown)
}

function createWindow() {
  win = new BrowserWindow({
    title: 'ClipClip Manager', width: 460, height: 560, minWidth: 380, minHeight: 420,
    show: false, icon, autoHideMenuBar: true, frame: process.platform !== 'win32', skipTaskbar: process.platform === 'win32',
    webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  const created = win
  const syncTaskbar = () => {
    if (process.platform === 'win32' && !created.isDestroyed()) {
      created.setSkipTaskbar((!!tray || testMode) && (!created.isVisible() || created.isMinimized()))
    }
  }
  created.on('show', syncTaskbar)
  created.on('hide', syncTaskbar)
  created.on('minimize', syncTaskbar)
  created.on('restore', syncTaskbar)
  const notifyFullscreen = (fullscreen: boolean) => {
    if (!created.webContents.isDestroyed()) created.webContents.send(CHANNELS.previewFullscreenChanged, fullscreen)
  }
  created.on('enter-full-screen', () => notifyFullscreen(true))
  created.on('leave-full-screen', () => notifyFullscreen(false))
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
  created.once('ready-to-show', showWindow)
  created.on('close', event => {
    if (!quitting && process.platform !== 'darwin' && tray) {
      event.preventDefault()
      void hideWindow().catch(() => {})
    }
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
  if (!testMode || process.env.CLIPCLIP_TEST_TRAY === '1') {
    const trayImage = nativeImage.createFromPath(icon)
    if (!trayImage.isEmpty()) try {
      tray = new Tray(trayImage.resize({ width: 20, height: 20 }))
      tray.setToolTip('ClipClip — Ctrl + Alt + B')
      tray.on('click', toggleTrayWindow)
      updateTray()
      if (testMode) app.emit('clipclip:test:tray-created', tray)
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
