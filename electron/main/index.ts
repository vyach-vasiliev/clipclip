import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, safeStorage, session, shell, Tray, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { CHANNELS, MAX_ITEM_BYTES, UNKNOWN_SOURCE, isFileUriList, type ClipboardSnapshot, type HistoryState } from '../../shared/clipboard'
import { ClipboardHistory, ClipboardMonitor } from './history'
import { EncryptedHistoryStorage } from './storage'
import { assetPath, isTrustedPage, requireId, requireTextRevision } from './security'
import { createWindowsShortcut } from './windowsShortcut'
import { DEFAULT_SHORTCUTS, restoreShortcuts, shortcutError, shortcutLabel, type ShortcutSettings } from '../../shared/shortcuts'
import { getWindowsClipboardOwnerReader } from './windowsClipboardSource'
import { FileChecker } from './files'
import { convertColor, isColorFormat } from '../../shared/colors'
import { BackupError, readBackup, serializeBackup, writeBackup } from './backup'
import type { BackupResult } from '../../shared/backup'
import { DEFAULT_TIME_FORMAT, isTimeFormat, type TimeFormat } from '../../shared/time'
import { version as appVersion } from '../../package.json'

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
let windowShortcut: ReturnType<typeof createWindowsShortcut> | null = null
let shortcuts: ShortcutSettings = { ...DEFAULT_SHORTCUTS }
let timeFormat: TimeFormat = DEFAULT_TIME_FORMAT
let shortcutCapture = false
let persistent = false
let storageError: string | null = null
let storage: EncryptedHistoryStorage | null = null
let revision = 0
let visibilityGeneration = 0
let trayTransition: Promise<void> = Promise.resolve()
let cachedImage: { digest: string; image: NonNullable<ClipboardSnapshot['image']> } | null = null
let transferring = false
const fileChecker = new FileChecker()
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

const history = new ClipboardHistory({ read: readSnapshot, source: getSource,
  fileKinds: async uris => (await fileChecker.check(uris)).kinds ?? uris.map(() => 'unknown') })
const monitor = new ClipboardMonitor(history)

function state(): HistoryState {
  return { revision, items: history.items, historyLimit: history.historyLimit, timeFormat, shortcuts, paused: history.paused, canUndo: history.canUndo,
    persistent, shortcutAvailable, error: storageError ?? history.error }
}

function broadcast() {
  revision++
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(CHANNELS.changed, state())
}

function updateTray() {
  tray?.setToolTip('ClipClip — ' + shortcutLabel(shortcuts.openWindow))
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть ClipClip', click: showWindow },
    { label: history.paused ? 'Продолжить запись' : 'Приостановить запись', click: () => history.setPaused(!history.paused) },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]))
}

function saveState() {
  if (storage) void storage.save({ items: history.items, paused: history.paused, historyLimit: history.historyLimit, timeFormat, shortcuts }).catch(() => {
    persistent = false
    storageError = 'Не удалось сохранить историю. Данные этой сессии остаются в памяти.'
    broadcast()
  })
}

function registerGlobalShortcut(accelerator: string): boolean {
  if (testMode && process.env.CLIPCLIP_TEST_SHORTCUT !== '1') return true
  try {
    if (process.platform === 'win32') {
      if (!win || win.isDestroyed()) return false
      windowShortcut ??= createWindowsShortcut(win, showWindow)
      return windowShortcut.set(accelerator)
    }
    if (globalShortcut.isRegistered(accelerator)) return true
    if (!globalShortcut.register(accelerator, showWindow)) return false
    if (shortcuts.openWindow !== accelerator) globalShortcut.unregister(shortcuts.openWindow)
    return true
  } catch { return false }
}

function finishShortcutCapture() {
  if (!shortcutCapture) return
  shortcutCapture = false
  shortcutAvailable = registerGlobalShortcut(shortcuts.openWindow)
  broadcast()
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
  handle(CHANNELS.checkFiles, async value => {
    const id = requireId(value)
    const item = history.items.find(candidate => candidate.id === id)
    if (!item?.fileUris) throw new Error('Файловая запись уже удалена.')
    const result = await fileChecker.check(item.fileUris)
    history.updateFileKinds(id, result.kinds)
    return result
  })
  handle(CHANNELS.revealFile, async value => {
    if (!value || typeof value !== 'object') throw new Error('Некорректный путь записи.')
    const request = value as { id?: unknown; index?: unknown }
    const id = requireId(request.id)
    const item = history.items.find(candidate => candidate.id === id)
    if (!item?.fileUris || typeof request.index !== 'number') throw new Error('Файловая запись уже недоступна.')
    return fileChecker.reveal(item.fileUris, request.index, path => {
      if (!history.items.includes(item)) throw new Error('Запись уже удалена.')
      if (testMode) app.emit('clipclip:test:file-revealed', path)
      else shell.showItemInFolder(path)
    })
  })
  handle(CHANNELS.copyItem, async value => {
    const id = requireId(value)
    const item = history.items.find(candidate => candidate.id === id)
    if (!item) throw new Error('Запись уже удалена.')
    if (item.fileUris) {
      const fileUris = item.fileUris
      const result = await fileChecker.copy(fileUris, async () => {
        if (!history.items.includes(item)) throw new Error('Запись уже удалена.')
        if (!testMode) await clipboard.write([new ClipboardItem({ 'text/uri-list': new Blob([fileUris.join('\r\n')], { type: 'text/uri-list' }) })])
      })
      if (result.status !== 'available') return result
    } else if (!testMode) {
      if (item.type !== 'image') await clipboard.writeText(item.data)
      else {
        const image = nativeImage.createFromDataURL(item.data)
        if (image.isEmpty()) throw new Error('Не удалось открыть изображение.')
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
      }
    }
    history.acknowledgeClipboard({ text: item.type !== 'image' && !item.fileUris ? item.data : '', fileUris: item.fileUris,
      image: item.type === 'image' ? { data: item.data, width: 1, height: 1 } : null })
  })
  handle(CHANNELS.copyFilePath, async value => {
    if (!value || typeof value !== 'object') throw new Error('Некорректный путь записи.')
    const request = value as { id?: unknown; index?: unknown }
    const id = requireId(request.id)
    const item = history.items.find(candidate => candidate.id === id)
    if (!item?.fileUris || typeof request.index !== 'number' || !Number.isInteger(request.index)
      || request.index < 0 || request.index >= item.fileUris.length) throw new Error('Путь записи недоступен.')
    // Copy the saved path even if its file has since been moved or deleted.
    const text = fileURLToPath(item.fileUris[request.index])
    if (testMode) app.emit('clipclip:test:path-copied', text)
    else await clipboard.writeText(text)
    return history.recordFilePathCopy(text)
  })
  handle(CHANNELS.copyColor, async value => {
    if (!value || typeof value !== 'object') throw new Error('Некорректный формат цвета.')
    const request = value as { id?: unknown; format?: unknown }
    const id = requireId(request.id)
    if (!isColorFormat(request.format)) throw new Error('Некорректный формат цвета.')
    const item = history.items.find(candidate => candidate.id === id)
    if (!item || item.type === 'image' || item.fileUris) throw new Error('Цветовая запись уже недоступна.')
    const text = convertColor(item.data, request.format)
    if (!testMode) await clipboard.writeText(text)
    return history.recordColorCopy(text)
  })
  handle(CHANNELS.deleteItem, value => history.delete(requireId(value)))
  handle(CHANNELS.saveTextRevision, value => {
    const { id, text } = requireTextRevision(value)
    return history.saveTextRevision(id, text)
  })
  handle(CHANNELS.undoDelete, () => history.undoDelete())
  handle(CHANNELS.setHistoryLimit, value => history.setHistoryLimit(value))
  handle(CHANNELS.setTimeFormat, value => {
    if (!isTimeFormat(value)) throw new Error('Некорректный формат времени.')
    if (timeFormat === value) return
    timeFormat = value
    broadcast()
    saveState()
  })
  handle(CHANNELS.setPinned, value => {
    if (!value || typeof value !== 'object') throw new Error('Некорректное избранное.')
    const request = value as { id?: unknown; pinned?: unknown }
    if (typeof request.pinned !== 'boolean') throw new Error('Некорректное избранное.')
    history.setPinned(requireId(request.id), request.pinned)
  })
  handle(CHANNELS.clearHistory, () => history.clear())
  handle(CHANNELS.exportHistory, () => transferHistory('export'))
  handle(CHANNELS.importHistory, value => {
    if (typeof value !== 'boolean') throw new Error('Некорректные параметры импорта.')
    return transferHistory('import', value)
  })
  handle(CHANNELS.setShortcuts, value => {
    const error = shortcutError(value)
    if (error) throw new Error(error)
    const next = value as ShortcutSettings
    if ((next.openWindow !== shortcuts.openWindow || !shortcutAvailable) && !registerGlobalShortcut(next.openWindow)) {
      throw new Error('Сочетание вызова окна занято другой программой или недоступно. Выберите другое.')
    }
    shortcuts = { ...next }
    shortcutAvailable = true
    broadcast()
    updateTray()
    saveState()
  })
  handle(CHANNELS.setShortcutCapture, value => {
    if (typeof value !== 'boolean') throw new Error('Некорректное состояние настройки клавиш.')
    if (!value) { finishShortcutCapture(); return }
    if (shortcutCapture) return
    shortcutCapture = true
    windowShortcut?.dispose()
    windowShortcut = null
    globalShortcut.unregister(shortcuts.openWindow)
  })
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

async function transferHistory(mode: 'import' | 'export', includeSettings = false): Promise<BackupResult> {
  if (transferring) return { status: 'error', message: 'Дождитесь завершения импорта или экспорта.' }
  const window = win
  if (!window || window.isDestroyed()) return { status: 'error', message: 'Окно недоступно.' }
  transferring = true
  const filters = [{ name: 'ClipClip JSON', extensions: ['json'] }]
  try {
    if (mode === 'export') {
      const selected = await dialog.showSaveDialog(window, { title: 'Экспорт ClipClip', filters,
        defaultPath: path.join(app.getPath('documents'), `clipclip-${new Date().toISOString().slice(0, 10)}.json`) })
      if (selected.canceled || !selected.filePath || window.isDestroyed() || win !== window) return { status: 'cancelled' }
      const text = serializeBackup(history.items, { historyLimit: history.historyLimit, paused: history.paused, timeFormat, shortcuts }, appVersion)
      await writeBackup(selected.filePath, text)
      return { status: 'success', message: 'История, избранное и настройки экспортированы в JSON.' }
    }
    const selected = await dialog.showOpenDialog(window, { title: 'Импорт ClipClip', filters, properties: ['openFile'] })
    if (selected.canceled || !selected.filePaths[0]) return { status: 'cancelled' }
    const manifest = await readBackup(selected.filePaths[0])
    // Check dimensions before decoding untrusted image data.
    for (const item of manifest.history) {
      if (item.type !== 'image') continue
      const bytes = Buffer.from(item.data.slice('data:image/png;base64,'.length), 'base64')
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
        || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20) || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000
        || nativeImage.createFromBuffer(bytes).isEmpty()) throw new BackupError('Файл содержит повреждённое изображение или изображение больше 16 мегапикселей.')
    }
    if (window.isDestroyed() || win !== window) return { status: 'cancelled' }
    if (includeSettings) {
      const next = manifest.settings.shortcuts
      if ((next.openWindow !== shortcuts.openWindow || !shortcutAvailable) && !registerGlobalShortcut(next.openWindow)) {
        throw new BackupError('Сочетание вызова окна занято. Импорт не выполнен. Повторите без применения настроек.')
      }
      shortcuts = { ...next }
      timeFormat = manifest.settings.timeFormat ?? DEFAULT_TIME_FORMAT
      shortcutAvailable = true
    }
    const result = history.importItems(manifest.history, includeSettings ? manifest.settings : undefined)
    return { status: 'success', message: `Добавлено: ${result.imported}. Дубликатов: ${result.duplicates}. Не вошло из-за лимитов: ${result.skipped}. Удалено прежних записей по лимитам: ${result.removed}.${includeSettings ? ' Настройки применены.' : ''}` }
  } catch (error) {
    return { status: 'error', message: error instanceof BackupError ? error.message
      : mode === 'export' ? 'Не удалось сохранить JSON. Проверьте доступ к выбранной папке.' : 'Не удалось импортировать JSON. Проверьте файл и доступ к нему.' }
  } finally { transferring = false }
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
  created.on('blur', finishShortcutCapture)
  created.on('hide', finishShortcutCapture)
  created.on('minimize', syncTaskbar)
  created.on('restore', syncTaskbar)
  const notifyFullscreen = (fullscreen: boolean) => {
    if (!created.webContents.isDestroyed()) created.webContents.send(CHANNELS.previewFullscreenChanged, fullscreen)
  }
  created.on('enter-full-screen', () => notifyFullscreen(true))
  created.on('leave-full-screen', () => notifyFullscreen(false))
  shortcutAvailable = registerGlobalShortcut(shortcuts.openWindow)
  created.setMenu(null)
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', event => { if (!isTrustedPage(event.url, entry)) event.preventDefault() })
  created.webContents.on('will-frame-navigate', event => {
    if (!event.isMainFrame || !isTrustedPage(event.url, entry)) event.preventDefault()
  })
  created.webContents.on('will-attach-webview', event => event.preventDefault())
  created.webContents.on('did-finish-load', broadcast)
  created.webContents.on('render-process-gone', finishShortcutCapture)
  created.webContents.on('did-start-loading', finishShortcutCapture)
  created.once('ready-to-show', showWindow)
  created.on('close', event => {
    if (!quitting && process.platform !== 'darwin' && tray) {
      event.preventDefault()
      void hideWindow().catch(() => {})
    }
  })
  created.on('closed', () => {
    shortcutCapture = false
    windowShortcut?.dispose()
    windowShortcut = null
    if (process.platform === 'win32') shortcutAvailable = false
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
      history.hydrate(restored.items, restored.paused, restored.historyLimit)
      shortcuts = restoreShortcuts(restored.shortcuts)
      timeFormat = isTimeFormat(restored.timeFormat) ? restored.timeFormat : DEFAULT_TIME_FORMAT
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
    saveState()
  })
  registerIpc()
  if (!testMode || process.env.CLIPCLIP_TEST_TRAY === '1') {
    const trayImage = nativeImage.createFromPath(icon)
    if (!trayImage.isEmpty()) try {
      tray = new Tray(trayImage.resize({ width: 20, height: 20 }))
      tray.on('click', toggleTrayWindow)
      updateTray()
      if (testMode) app.emit('clipclip:test:tray-created', tray)
    } catch { tray = null }
  }
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
  windowShortcut?.dispose()
  windowShortcut = null
  if (storage) {
    event.preventDefault()
    void storage.flush().catch(() => {}).finally(() => app.quit())
  }
})
