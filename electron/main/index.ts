import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, safeStorage, session, shell, Tray, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { CHANNELS, MAX_HISTORY_LIMIT, MAX_ITEM_BYTES, UNKNOWN_SOURCE, isFileUriList, isHistoryLimit, type ClipboardSnapshot, type HistoryState, type ItemActivationResult } from '../../shared/clipboard'
import { ClipboardHistory, ClipboardMonitor } from './history'
import { EncryptedHistoryStorage, HistoryStorageLimitError } from './storage'
import { assetPath, isTrustedPage, requireId, requireTextRevision } from './security'
import { createWindowsShortcut, type ShortcutReservation } from './windowsShortcut'
import { DEFAULT_SHORTCUTS, restoreShortcuts, shortcutError, shortcutLabel, type ShortcutSettings } from '../../shared/shortcuts'
import { createWindowsClipboardOwnerListener, getWindowsClipboardOwnerReader } from './windowsClipboardSource'
import { FileChecker } from './files'
import { convertColor, isColorFormat } from '../../shared/colors'
import { BackupError, readBackup, serializeBackup, writeBackup } from './backup'
import type { BackupResult } from '../../shared/backup'
import { DEFAULT_TIME_FORMAT, isTimeFormat, type TimeFormat } from '../../shared/time'
import { ClipboardChangedError, createWindowsPaste, PasteError, readWindowHandle, type PasteTarget } from './windowsPaste'
import { createWindowsQuickPickKeys } from './windowsQuickPick'
import { createWindowsClipboardAccess, readAllowedClipboard, type WindowsClipboardAccess } from './windowsClipboard'
import { encodedImageDimensions, exceedsImagePixelLimit, type EncodedImageFormat } from './imageDimensions'
import { decodeDib } from './windowsBitmap'
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
let readyWindow: BrowserWindow | null = null
let initialized = false
let tray: Tray | null = null
let quitting = false
let shortcutAvailable = false
let windowShortcut: ReturnType<typeof createWindowsShortcut> | null = null
let clipboardOwnerListener: ReturnType<typeof createWindowsClipboardOwnerListener> | null = null
let shortcuts: ShortcutSettings = { ...DEFAULT_SHORTCUTS }
let pasteOnSelect = true
let promoteCopiedRecords = true
let windowsPaste: ReturnType<typeof createWindowsPaste> | null = null
type QuickPickSession = {
  window: BrowserWindow
  target: PasteTarget
  keys: ReturnType<typeof createWindowsQuickPickKeys>
  watch: ReturnType<typeof setInterval>
  hiddenForPaste: boolean
  isCurrent(): boolean
}
let quickPick: QuickPickSession | null = null
const QUICK_PICK_FOCUS_SETTLE_MS = 200
let activating = false
const PASTE_MARKER_FORMAT = 'web application/x-clipclip-paste-transaction'
let fixturePasteClipboard = { sequence: 0, marker: '' }
let timeFormat: TimeFormat = DEFAULT_TIME_FORMAT
let shortcutCapture = false
let persistent = false
let storageError: string | null = null
let storage: EncryptedHistoryStorage | null = null
let revision = 0
let visibilityGeneration = 0
let trayTransition: Promise<void> = Promise.resolve()
let cachedImage: { digest: string; image: NonNullable<ClipboardSnapshot['image']> } | null = null
let windowsClipboard: WindowsClipboardAccess | undefined
let transferring = false
let publishingSavedImport = false
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
const getWindowsClipboard = () => windowsClipboard ??= createWindowsClipboardAccess()

async function readSnapshot(): Promise<ClipboardSnapshot | undefined> {
  if (testMode) {
    const fixture = process.env.CLIPCLIP_TEST_IMAGE ? nativeImage.createFromDataURL(process.env.CLIPCLIP_TEST_IMAGE) : null
    return { text: process.env.CLIPCLIP_TEST_TEXT ?? 'Проверка поиска: [ скобка, точка.\nВторая строка',
      image: fixture && !fixture.isEmpty() ? { data: fixture.toDataURL(), ...fixture.getSize() } : null,
      fileUris: process.env.CLIPCLIP_TEST_FILES ? JSON.parse(process.env.CLIPCLIP_TEST_FILES) : undefined }
  }
  if (process.platform !== 'win32') return readClipboardSnapshot()
  const access = getWindowsClipboard()
  const excluded: ClipboardSnapshot = { text: '', image: null }
  const snapshot = await readAllowedClipboard(access, isCurrent => readClipboardSnapshot(isCurrent, access), excluded)
  if (snapshot === excluded) cachedImage = null
  return snapshot
}

async function readClipboardSnapshot(
  isCurrent = () => true, windowsAccess?: WindowsClipboardAccess,
): Promise<ClipboardSnapshot | undefined> {
  // Capture the owner before asynchronous clipboard decoding can outlive its window.
  const ownerReader = getWindowsClipboardOwnerReader()
  const ownerCapture = ownerReader?.capture()
  const items = await clipboard.read()
  if (!isCurrent()) return
  const textItem = items.find(item => item.types.includes('text/plain'))
  const textBlob = textItem ? await textItem.getType('text/plain') : null
  let warning: string | undefined
  if (textBlob && textBlob.size > MAX_ITEM_BYTES) warning = 'Текст больше 8 МБ пропущен.'
  const text = textBlob && !warning ? await textBlob.text() : ''
  if (!isCurrent()) return
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
  if (!isCurrent()) return
  const noImage = { text, image: null, fileUris, warning }
  const invalidImage = 'Изображение не удалось прочитать.'
  const byteLimit = 'Изображение больше 8 МБ пропущено.'
  const pixelLimit = 'Изображение больше 16 мегапикселей пропущено.'
  const native = windowsAccess?.readImage()
  if (!isCurrent() || (windowsAccess && !native)) return
  if (native?.status === 'invalid') return { ...noImage, warning: invalidImage }
  if (native?.status === 'byte-limit') return { ...noImage, warning: byteLimit }
  if (native?.status === 'pixel-limit') return { ...noImage, warning: pixelLimit }
  let format: EncodedImageFormat | undefined
  let bytes: Buffer
  if (native?.status === 'encoded' || native?.status === 'bitmap') {
    if (native.status === 'encoded') format = native.format
    bytes = native.bytes
  } else {
    const imageItem = native?.status !== 'empty'
      ? items.find(item => item.types.includes('image/png') || item.types.includes('image/jpeg')) : undefined
    if (!imageItem) { cachedImage = null; return noImage }
    format = imageItem.types.includes('image/png') ? 'image/png' : 'image/jpeg'
    const blob = await imageItem.getType(format)
    if (blob.size > MAX_ITEM_BYTES) return { ...noImage, warning: byteLimit }
    bytes = Buffer.from(await blob.arrayBuffer())
  }
  if (!isCurrent()) return
  if (format) {
    const dimensions = encodedImageDimensions(bytes, format)
    if (!dimensions) return { ...noImage, warning: invalidImage }
    if (exceedsImagePixelLimit(dimensions)) return { ...noImage, warning: pixelLimit }
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (cachedImage?.digest === digest) return { text, image: cachedImage.image, imageSource: ownerReader?.resolve(ownerCapture), fileUris, warning }
  const bitmap = native?.status === 'bitmap' ? decodeDib(bytes) : undefined
  if (native?.status === 'bitmap' && !bitmap) return { ...noImage, warning: invalidImage }
  const image = bitmap ? nativeImage.createFromBitmap(bitmap.pixels, bitmap) : nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return { ...noImage, warning: invalidImage }
  const { width, height } = image.getSize()
  if (exceedsImagePixelLimit({ width, height })) return { ...noImage, warning: pixelLimit }
  const data = image.toDataURL()
  if (Buffer.byteLength(data, 'utf8') > MAX_ITEM_BYTES) return { ...noImage, warning: byteLimit }
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

const history = new ClipboardHistory({
  read: readSnapshot,
  sequence: process.platform === 'win32' && !testMode ? () => getWindowsClipboard().sequence() : undefined,
  source: getSource,
})
const monitor = new ClipboardMonitor(history)

function state(): HistoryState {
  return { revision, items: history.items, historyLimit: history.historyLimit, pasteOnSelect, promoteCopiedRecords, pasteAvailable: windowsPaste !== null,
    timeFormat, shortcuts, paused: history.paused, canUndo: history.canUndo,
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
    { label: history.paused ? 'Продолжить запись' : 'Приостановить запись', click: () => { void history.setPaused(!history.paused).catch(() => {}) } },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]))
}

function saveState() {
  if (storage && !publishingSavedImport) void storage.save({ items: history.items, paused: history.paused, historyLimit: history.historyLimit,
    pasteOnSelect, promoteCopiedRecords, timeFormat, shortcuts, clipboardClearBaseline: history.clipboardClearBaseline }).catch(() => {
    persistent = false
    storageError = 'Не удалось сохранить историю. Данные этой сессии остаются в памяти.'
    broadcast()
  })
}

function publishState() {
  broadcast()
  updateTray()
  saveState()
}

function reserveGlobalShortcut(accelerator: string): ShortcutReservation | null {
  if (testMode && process.env.CLIPCLIP_TEST_SHORTCUT !== '1') return { commit() {}, cancel() {} }
  try {
    if (process.platform === 'win32') {
      if (!win || win.isDestroyed()) return null
      // Change native window styles after WM_HOTKEY has returned to Windows.
      windowShortcut ??= createWindowsShortcut(win, () => { setImmediate(showFromShortcut) })
      return windowShortcut.reserve(accelerator)
    }
    if (globalShortcut.isRegistered(accelerator)) return { commit() {}, cancel() {} }
    const previous = shortcuts.openWindow
    let active = false
    if (!globalShortcut.register(accelerator, () => { if (active) showWindow() })) return null
    return {
      commit() {
        active = true
        if (previous !== accelerator) globalShortcut.unregister(previous)
      },
      cancel() { globalShortcut.unregister(accelerator) },
    }
  } catch { return null }
}

function registerGlobalShortcut(accelerator: string): boolean {
  const reservation = reserveGlobalShortcut(accelerator)
  if (!reservation) return false
  reservation.commit()
  return true
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
  handle(CHANNELS.checkFile, async value => {
    if (!value || typeof value !== 'object') throw new Error('Некорректный путь записи.')
    const request = value as { id?: unknown; index?: unknown }
    const id = requireId(request.id)
    const { index } = request
    const item = history.items.find(candidate => candidate.id === id)
    if (!item?.fileUris || typeof index !== 'number') throw new Error('Файловая запись уже недоступна.')
    const result = await fileChecker.checkPath(item.fileUris, index)
    if (history.items.includes(item) && result.kinds?.[0]) {
      const kind = result.kinds[0]
      history.updateFileKinds(id, item.fileUris.map((_, position) => position === index ? kind : 'unknown'))
    }
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
  const copyItem = async (value: unknown, pasteMarker?: string, beforeWrite?: () => void) => {
    const id = requireId(value)
    const item = history.items.find(candidate => candidate.id === id)
    if (!item) throw new Error('Запись уже удалена.')
    const snapshot: ClipboardSnapshot = {
      text: item.type !== 'image' && !item.fileUris ? item.data : '',
      fileUris: item.fileUris, image: item.type === 'image' ? { data: item.data, width: 1, height: 1 } : null,
    }
    const write = async () => {
      beforeWrite?.()
      if (testMode) {
        if (pasteMarker) {
          fixturePasteClipboard = { sequence: fixturePasteClipboard.sequence + 1, marker: pasteMarker }
          app.emit('clipclip:test:paste-clipboard', { sequence: fixturePasteClipboard.sequence, snapshot }, () => {
            fixturePasteClipboard = { sequence: fixturePasteClipboard.sequence + 1, marker: '' }
          })
        }
        return
      }
      let data: Record<string, Blob | string>
      if (item.fileUris) {
        data = { 'text/uri-list': new Blob([item.fileUris.join('\r\n')], { type: 'text/uri-list' }) }
      } else if (item.type === 'image') {
        const image = nativeImage.createFromDataURL(item.data)
        if (image.isEmpty()) throw new Error('Не удалось открыть изображение.')
        data = { 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) }
      } else {
        if (!pasteMarker) return clipboard.writeText(item.data)
        data = { 'text/plain': item.data }
      }
      // The marker and the selected value are committed in the same native write.
      if (pasteMarker) data[PASTE_MARKER_FORMAT] = new Blob([pasteMarker])
      await clipboard.write([new ClipboardItem(data)])
    }
    if (item.fileUris) {
      const fileUris = item.fileUris
      const result = await fileChecker.copy(fileUris, async () => {
        if (!history.items.includes(item)) throw new Error('Запись уже удалена.')
        await write()
      })
      if (history.items.includes(item)) history.updateFileKinds(id, result.kinds)
      if (result.status !== 'available') return result
    } else await write()
    history.acknowledgeClipboard(snapshot)
    if (promoteCopiedRecords) history.promoteCopiedItem(item.id)
  }
  handle(CHANNELS.copyItem, copyItem)
  handle(CHANNELS.activateItem, async (value): Promise<void | ItemActivationResult> => {
    if (activating) throw new Error('Дождитесь завершения вставки.')
    const window = win
    const quick = quickPick
    const acceptsSelection = () => quick ? quick.isCurrent() : Boolean(window?.isFocused())
    if (!window || window.isDestroyed() || !window.isVisible()) throw new Error('Окно ClipClip неактивно.')
    if (!acceptsSelection()) {
      if (quick) return { status: 'paste-unavailable', message: 'Исходное окно потеряло фокус. Вызовите ClipClip из нужного поля.' }
      throw new Error('Окно ClipClip неактивно.')
    }
    const generation = visibilityGeneration
    const sameWindow = () => generation === visibilityGeneration && !quitting
      && win === window && !window.isDestroyed() && !window.isMinimized()
    const current = () => sameWindow() && (window.isVisible() || quick?.hiddenForPaste === true)
      && (!quick || quick.isCurrent())
    const testTargetPid = testMode ? Number(process.env.CLIPCLIP_TEST_PASTE_TARGET_PID) : 0
    const controller = windowsPaste
    const shouldPaste = pasteOnSelect && controller !== null && (!testMode || testTargetPid > 0)
    if (quick && !shouldPaste) throw new PasteError('Автоматическая вставка недоступна.')
    const target = shouldPaste ? quick?.target ?? controller?.target() : null
    const pasteMarker = target && (!testMode || target.pid === testTargetPid) ? randomUUID() : undefined
    activating = true
    try {
      const result = await copyItem(value, pasteMarker, quick ? () => {
        if (!current()) throw new PasteError('Прежнее окно потеряло фокус.')
        quick.hiddenForPaste = true
        window.hide()
      } : undefined)
      if (result && result.status !== 'available') return result
      const copiedOnly = (reason: string): ItemActivationResult => ({
        status: 'paste-unavailable', canPasteManually: true, message: reason + ' Запись скопирована, её можно вставить вручную через Ctrl+V.',
      })
      if (shouldPaste) {
        if (!controller || !target || !pasteMarker) {
          return copiedOnly('Не найдено прежнее окно для вставки.')
        }
        const sequence = controller.clipboardSequence()
        let markerVerified = false
        try {
          let actualMarker: string | undefined
          if (testMode) actualMarker = fixturePasteClipboard.marker
          else {
            const clipboardItem = (await clipboard.read()).find(item => item.types.includes(PASTE_MARKER_FORMAT))
            if (clipboardItem) actualMarker = await (await clipboardItem.getType(PASTE_MARKER_FORMAT)).text()
          }
          if (!sequence || actualMarker !== pasteMarker || sequence !== controller.clipboardSequence()) throw new ClipboardChangedError()
          markerVerified = true
          if (!current() || !acceptsSelection()) return copiedOnly('Выбранное окно потеряло фокус.')
          if (quick) await controller.pasteIntoForeground(target, sequence, current)
          else await controller.paste(target, readWindowHandle(window.getNativeWindowHandle()), sequence, current)
        }
        catch (error) {
          if (!markerVerified || error instanceof ClipboardChangedError || sequence !== controller.clipboardSequence()) {
            return { status: 'paste-unavailable', message: new ClipboardChangedError().message }
          }
          return copiedOnly(error instanceof PasteError ? error.message : 'Не удалось выполнить автоматическую вставку.')
        }
      } else if (!current() || !window.isFocused()) return copiedOnly('Выбранное окно потеряло фокус.')
      if (quick) {
        if (quickPick === quick) closeQuickPick({ hide: false })
      } else if (current()) await hideWindow()
    } finally {
      activating = false
      if (quick?.hiddenForPaste && quickPick === quick && sameWindow()) {
        quick.hiddenForPaste = false
        window.showInactive()
        window.moveTop()
      }
    }
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
  handle(CHANNELS.setHistoryLimit, value => {
    const request = value && typeof value === 'object' ? value as { limit?: unknown; maxRemoved?: unknown } : null
    const limit = request ? request.limit : value
    const maxRemoved = request ? request.maxRemoved : 0
    if (!isHistoryLimit(limit) || typeof maxRemoved !== 'number' || !Number.isInteger(maxRemoved)
      || maxRemoved < 0 || maxRemoved > MAX_HISTORY_LIMIT) throw new Error('Некорректный лимит истории.')
    const ordinaryCount = history.items.filter(item => !item.pinned).length
    if (ordinaryCount - limit > maxRemoved) throw new Error('История изменилась. Проверьте новый лимит и подтвердите удаление.')
    history.setHistoryLimit(limit)
  })
  handle(CHANNELS.setPasteOnSelect, value => {
    if (typeof value !== 'boolean') throw new Error('Некорректная настройка вставки.')
    pasteOnSelect = value
    broadcast()
    saveState()
  })
  handle(CHANNELS.setTimeFormat, value => {
    if (!isTimeFormat(value)) throw new Error('Некорректный формат времени.')
    if (timeFormat === value) return
    timeFormat = value
    broadcast()
    saveState()
  })
  handle(CHANNELS.setPromoteCopiedRecords, value => {
    if (typeof value !== 'boolean') throw new Error('Некорректная настройка истории.')
    if (promoteCopiedRecords === value) return
    promoteCopiedRecords = value
    publishState()
  })
  handle(CHANNELS.resetSettings, async () => {
    const resume = await history.prepareResume()
    const defaultBinding = DEFAULT_SHORTCUTS.openWindow
    if ((shortcutCapture || !shortcutAvailable || shortcuts.openWindow !== defaultBinding) && !registerGlobalShortcut(defaultBinding)) {
      throw new Error('Стандартное сочетание вызова окна занято другой программой или недоступно.')
    }
    shortcutCapture = false
    shortcutAvailable = true
    shortcuts = { ...DEFAULT_SHORTCUTS }
    pasteOnSelect = true
    promoteCopiedRecords = true
    timeFormat = DEFAULT_TIME_FORMAT
    if (!history.resetSettings(resume)) publishState()
  })
  handle(CHANNELS.setPinned, value => {
    if (!value || typeof value !== 'object') throw new Error('Некорректное избранное.')
    const request = value as { id?: unknown; pinned?: unknown }
    if (typeof request.pinned !== 'boolean') throw new Error('Некорректное избранное.')
    history.setPinned(requireId(request.id), request.pinned)
  })
  handle(CHANNELS.clearHistory, async () => {
    await history.clear()
    await storage?.flush()
  })
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
    publishState()
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
    return history.setPaused(value)
  })
  handle(CHANNELS.setPreviewFullscreen, value => {
    if (typeof value !== 'boolean') throw new Error('Некорректный полноэкранный режим.')
    return setWindowFullscreen(value)
  })
  handle(CHANNELS.hideWindow, hideWindow)
  handle(CHANNELS.openFullWindow, () => {
    const pick = quickPick
    if (!pick || pick.window.isDestroyed() || !pick.window.isVisible()) throw new Error('Быстрый режим уже закрыт.')
    windowsPaste?.capture()
    closeQuickPick({ hide: false })
    pick.window.setSkipTaskbar(false)
    pick.window.focus()
  })
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
      const text = serializeBackup(history.items, {
        historyLimit: history.historyLimit, paused: history.paused, pasteOnSelect, promoteCopiedRecords, timeFormat, shortcuts,
      }, appVersion)
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
      const dimensions = encodedImageDimensions(bytes, 'image/png')
      if (!dimensions || exceedsImagePixelLimit(dimensions)
        || nativeImage.createFromBuffer(bytes).isEmpty()) throw new BackupError('Файл содержит повреждённое изображение или изображение больше 16 мегапикселей.')
    }
    if (window.isDestroyed() || win !== window) return { status: 'cancelled' }
    const settings = includeSettings ? manifest.settings : undefined
    let plan = history.planImport(manifest.history, settings)
    while (plan.removedIds.length) {
      const disclosedIds = new Set(plan.removedIds)
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning', title: 'Импорт ClipClip', message: 'Импортировать с удалением записей?',
        detail: `Из текущей истории будет удалено записей — ${disclosedIds.size}.`
          + (settings ? ` Новый лимит обычной истории — ${plan.historyLimit}.` : ''),
        buttons: ['Отмена', 'Импортировать и удалить'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (response !== 1 || window.isDestroyed() || win !== window || quitting) return { status: 'cancelled' }
      plan = history.planImport(manifest.history, settings)
      if (plan.removedIds.every(id => disclosedIds.has(id))) break
    }

    const baseRevision = revision
    const resuming = history.paused && !plan.paused
    const prepareResume = () => history.prepareResume().catch(() => {
      throw new BackupError('Буфер обмена временно недоступен. Повторите импорт.')
    })
    const resume = resuming ? await prepareResume() : undefined
    if (resuming && !resume) throw new BackupError('Запись истории изменилась во время импорта. Повторите импорт.')
    const nextShortcuts = settings?.shortcuts ?? shortcuts
    const nextPasteOnSelect = settings ? settings.pasteOnSelect ?? true : pasteOnSelect
    const nextTimeFormat = settings ? settings.timeFormat ?? DEFAULT_TIME_FORMAT : timeFormat
    const nextPromoteCopiedRecords = settings ? settings.promoteCopiedRecords ?? true : promoteCopiedRecords
    const destination = storage
    const apply = async (replace?: () => void) => {
      let currentResume = resume
      if (replace && resume && !('sequence' in resume)) {
        // Without a native sequence, make sure staging did not outlive the sampled clipboard.
        currentResume = await prepareResume()
        if (!currentResume || JSON.stringify(currentResume.persisted) !== JSON.stringify(resume.persisted)) {
          throw new BackupError('Буфер обмена изменился во время подготовки импорта. Повторите импорт.')
        }
      }
      if (quitting || window.isDestroyed() || win !== window || revision !== baseRevision) {
        throw new BackupError('История или настройки изменились во время импорта. Повторите импорт.')
      }
      let reservation: ShortcutReservation | null = null
      if (settings && (nextShortcuts.openWindow !== shortcuts.openWindow || !shortcutAvailable)) {
        reservation = reserveGlobalShortcut(nextShortcuts.openWindow)
        if (!reservation) throw new BackupError('Сочетание вызова окна занято. Импорт не выполнен. Повторите без применения настроек.')
      }
      try { replace?.() }
      catch (error) { reservation?.cancel(); throw error }
      reservation?.commit()
      if (settings) {
        shortcuts = { ...nextShortcuts }
        pasteOnSelect = nextPasteOnSelect
        promoteCopiedRecords = nextPromoteCopiedRecords
        timeFormat = nextTimeFormat
        shortcutAvailable = true
      }
      if (destination) {
        persistent = true
        storageError = null
      }
      publishingSavedImport = !!destination
      try { history.commitImport(plan, currentResume) }
      finally { publishingSavedImport = false }
    }
    if (destination) {
      try {
        await destination.save({ items: plan.items, paused: plan.paused, historyLimit: plan.historyLimit,
          pasteOnSelect: nextPasteOnSelect, promoteCopiedRecords: nextPromoteCopiedRecords, timeFormat: nextTimeFormat, shortcuts: nextShortcuts,
          clipboardClearBaseline: resume?.persisted ?? history.clipboardClearBaseline }, apply)
      } catch (error) {
        if (error instanceof BackupError) throw error
        if (error instanceof HistoryStorageLimitError) throw new BackupError(error.message)
        throw new BackupError('Не удалось сохранить результат импорта. Проверьте место на диске и права доступа.')
      }
    } else await apply()
    const { result } = plan
    const storageNotice = destination ? '' : ' Импортировано в текущую сессию. Шифрованное хранилище недоступно.'
    return { status: 'success', message: `Добавлено: ${result.imported}. Дубликатов: ${result.duplicates}. Не вошло из-за лимитов: ${result.skipped}. Удалено прежних записей по лимитам: ${result.removed}.${settings ? ' Настройки применены.' : ''}${storageNotice}` }
  } catch (error) {
    return { status: 'error', message: error instanceof BackupError ? error.message
      : mode === 'export' ? 'Не удалось сохранить JSON. Проверьте доступ к выбранной папке.' : 'Не удалось импортировать JSON. Проверьте файл и доступ к нему.' }
  } finally { transferring = false }
}

async function hideWindow() {
  const window = win
  if (!window || window.isDestroyed()) return
  if (quickPick?.window === window) { closeQuickPick(); return }
  const generation = ++visibilityGeneration
  await setWindowFullscreen(false)
  if (generation !== visibilityGeneration || window.isDestroyed() || window !== win) return
  if (!tray && !shortcutAvailable && !testMode) window.minimize()
  else window.hide()
}

function closeQuickPick({ hide = true, keepOnTop = false } = {}) {
  const pick = quickPick
  if (!pick) return
  quickPick = null
  visibilityGeneration++
  clearInterval(pick.watch)
  pick.keys.dispose()
  const window = pick.window
  if (window.isDestroyed()) return
  if (hide) window.hide()
  if (!keepOnTop && window.isAlwaysOnTop()) window.setAlwaysOnTop(false)
  window.setFocusable(true)
  if (!window.webContents.isDestroyed()) window.webContents.send(CHANNELS.quickPickChanged, false)
}

function showFromShortcut() {
  if (!initialized || quitting || activating) return
  const window = win
  const controller = windowsPaste
  const target = pasteOnSelect ? controller?.foregroundTarget() : null
  if (window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
    && (quickPick?.isCurrent() || (!target && window.isAlwaysOnTop()))) {
    window.moveTop()
    return
  }
  if (!window || window.isDestroyed() || readyWindow !== window || !controller || !target
    || window.isFullScreen() || window.isMinimized()
    || (testMode && target.pid !== Number(process.env.CLIPCLIP_TEST_PASTE_TARGET_PID))) {
    if (!quickPick) showWindow()
    return
  }
  // An explicit invocation can bind an open picker to a new destination.
  if (quickPick) closeQuickPick({ hide: false, keepOnTop: true })
  const pickerHandle = readWindowHandle(window.getNativeWindowHandle())
  const isCurrent = () => !quitting && quickPick?.isCurrent === isCurrent && controller.isForegroundTarget(target)
  let keys: ReturnType<typeof createWindowsQuickPickKeys>
  try {
    keys = createWindowsQuickPickKeys(() => !quickPick?.hiddenForPaste && isCurrent(), action => {
      if (action === 'dismiss') closeQuickPick()
      else if (!activating && !window.webContents.isDestroyed()) window.webContents.send(CHANNELS.quickPickAction, action)
    }, testMode ? 0x434c4950 : undefined)
  } catch {
    showWindow()
    return
  }
  visibilityGeneration++
  let pickerFocusedSince: number | null = null
  const watch = setInterval(() => {
    if (quickPick?.isCurrent !== isCurrent) return
    // Foreground transitions only suspend quick input. They must never hide the picker.
    if (!window.isVisible() || controller.foregroundHandle() !== pickerHandle) {
      pickerFocusedSince = null
      return
    }
    const now = performance.now()
    pickerFocusedSince ??= now
    if (now - pickerFocusedSince < QUICK_PICK_FOCUS_SETTLE_MS) return
    // Keep the picker above the invoking app even if Windows activated it.
    controller.capture(target.hwnd)
    closeQuickPick({ hide: false, keepOnTop: true })
    window.setSkipTaskbar(false)
    window.moveTop()
    window.webContents.send(CHANNELS.windowShown)
  }, 35)
  watch.unref()
  quickPick = { window, target, keys, watch, isCurrent, hiddenForPaste: false }
  try {
    window.setFocusable(false)
    window.setAlwaysOnTop(true)
    window.webContents.send(CHANNELS.quickPickChanged, true)
    window.webContents.send(CHANNELS.windowShown)
    window.showInactive()
    window.moveTop()
  } catch {
    showWindow()
  }
}

function toggleTrayWindow() {
  trayTransition = trayTransition.then(async () => {
    if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) await hideWindow()
    else showWindow()
  }).catch(() => { if (!quitting) showWindow() })
}
function showWindow() {
  if (!initialized || quitting) return
  closeQuickPick({ hide: false })
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (readyWindow !== win) return
  windowsPaste?.capture()
  visibilityGeneration++
  if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false)
  if (process.platform === 'win32') win.setSkipTaskbar(false)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(CHANNELS.windowShown)
}

function createWindow() {
  if (win && !win.isDestroyed()) return
  win = new BrowserWindow({
    title: 'ClipClip Manager', width: 460, height: 560, minWidth: 380, minHeight: 420,
    show: false, icon, autoHideMenuBar: true, frame: process.platform !== 'win32', skipTaskbar: process.platform === 'win32',
    webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  const created = win
  if (windowsPaste) {
    try { windowsPaste.trackWindow(created) }
    catch { windowsPaste.dispose(); windowsPaste = null }
  }
  if (process.platform === 'win32' && !testMode) {
    try {
      const reader = getWindowsClipboardOwnerReader()
      if (reader) clipboardOwnerListener = createWindowsClipboardOwnerListener(created, {
        capture: () => { if (!history.paused) reader.capture() },
      })
    } catch { /* Polling can still resolve owners when notifications are unavailable. */ }
  }
  const syncTaskbar = () => {
    if (process.platform !== 'win32' || created.isDestroyed()) return
    const visible = created.isVisible()
    if (quickPick?.window === created && visible) return
    created.setSkipTaskbar((!!tray || testMode) && (!visible || created.isMinimized()))
  }
  created.on('show', syncTaskbar)
  created.on('hide', syncTaskbar)
  created.on('blur', finishShortcutCapture)
  created.on('hide', finishShortcutCapture)
  const releaseHiddenPicker = () => {
    if (created.isDestroyed()) return
    if (quickPick?.window === created) {
      if (!quickPick.hiddenForPaste) closeQuickPick({ hide: false })
    } else if (created.isAlwaysOnTop()) created.setAlwaysOnTop(false)
  }
  created.on('hide', releaseHiddenPicker)
  created.on('minimize', releaseHiddenPicker)
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
  created.webContents.on('render-process-gone', () => { if (quickPick?.window === created) closeQuickPick() })
  created.webContents.on('did-start-loading', () => { if (quickPick?.window === created) closeQuickPick() })
  created.once('ready-to-show', () => {
    if (win !== created || created.isDestroyed()) return
    readyWindow = created
    showWindow()
  })
  created.on('close', event => {
    if (!quitting && process.platform !== 'darwin' && tray) {
      event.preventDefault()
      void hideWindow().catch(() => {})
    }
  })
  created.on('closed', () => {
    if (quickPick?.window === created) closeQuickPick()
    clipboardOwnerListener?.dispose()
    clipboardOwnerListener = null
    shortcutCapture = false
    windowShortcut?.dispose()
    windowShortcut = null
    if (process.platform === 'win32') shortcutAvailable = false
    if (readyWindow === created) readyWindow = null
    if (win === created) win = null
  })
  void created.loadURL(entry).catch(() => { storageError = 'Не удалось открыть интерфейс приложения.' })
  if (!app.isPackaged && process.env.CLIPCLIP_DEVTOOLS === '1') created.webContents.openDevTools()
}

async function initialize() {
  if (testMode) await new Promise<void>(resolve => {
    if (!app.emit('clipclip:test:initializing', resolve)) resolve()
  })
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
      history.hydrate(restored.items, restored.paused, restored.historyLimit, restored.clipboardClearBaseline)
      shortcuts = restoreShortcuts(restored.shortcuts)
      pasteOnSelect = typeof restored.pasteOnSelect === 'boolean' ? restored.pasteOnSelect : true
      promoteCopiedRecords = typeof restored.promoteCopiedRecords === 'boolean' ? restored.promoteCopiedRecords : true
      timeFormat = isTimeFormat(restored.timeFormat) ? restored.timeFormat : DEFAULT_TIME_FORMAT
      persistent = true
    }
  } catch {
    storageError = 'Зашифрованная история недоступна. Данные этой сессии остаются в памяти.'
    storage = null
    persistent = false
  }
  if (quitting) return
  history.subscribe(publishState)
  if (process.platform === 'win32' && (!testMode || process.env.CLIPCLIP_TEST_PASTE === '1')) {
    try { windowsPaste = createWindowsPaste(testMode ? () => fixturePasteClipboard.sequence : undefined) }
    catch { /* Clipboard copying remains available. */ }
  }
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
  initialized = true
  showWindow()
  monitor.start()
}

void app.whenReady().then(initialize).catch(() => { console.error('ClipClip could not start.'); app.quit() })
app.on('second-instance', showWindow)
app.on('activate', showWindow)
if (testMode && process.env.CLIPCLIP_TEST_PASTE === '1') {
  (app as NodeJS.EventEmitter).on('clipclip:test:open-quick-pick', showFromShortcut)
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit() })
app.on('before-quit', event => {
  if (quitting) return
  quitting = true
  closeQuickPick()
  monitor.stop()
  windowsPaste?.dispose()
  windowsPaste = null
  clipboardOwnerListener?.dispose()
  clipboardOwnerListener = null
  history.dispose()
  globalShortcut.unregisterAll()
  windowShortcut?.dispose()
  windowShortcut = null
  if (storage) {
    event.preventDefault()
    void storage.flush().catch(() => {}).finally(() => app.quit())
  }
})
