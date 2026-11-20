import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ElectronAPI, type HistoryState, type QuickPickAction } from '../../shared/clipboard'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ElectronAPI = {
  getHistory: () => ipcRenderer.invoke(CHANNELS.getHistory),
  onHistoryChanged: callback => subscribe<HistoryState>(CHANNELS.changed, callback),
  activateItem: id => ipcRenderer.invoke(CHANNELS.activateItem, id),
  copyItem: id => ipcRenderer.invoke(CHANNELS.copyItem, id),
  copyColor: (id, format) => ipcRenderer.invoke(CHANNELS.copyColor, { id, format }),
  checkFile: (id, index) => ipcRenderer.invoke(CHANNELS.checkFile, { id, index }),
  revealFile: (id, index) => ipcRenderer.invoke(CHANNELS.revealFile, { id, index }),
  copyFilePath: (id, index) => ipcRenderer.invoke(CHANNELS.copyFilePath, { id, index }),
  saveTextRevision: (id, text) => ipcRenderer.invoke(CHANNELS.saveTextRevision, { id, text }),
  deleteItem: id => ipcRenderer.invoke(CHANNELS.deleteItem, id),
  undoDelete: () => ipcRenderer.invoke(CHANNELS.undoDelete),
  setPaused: paused => ipcRenderer.invoke(CHANNELS.setPaused, paused),
  setHistoryLimit: (limit, maxRemoved) => ipcRenderer.invoke(CHANNELS.setHistoryLimit, maxRemoved === undefined ? limit : { limit, maxRemoved }),
  setPasteOnSelect: enabled => ipcRenderer.invoke(CHANNELS.setPasteOnSelect, enabled),
  setPromoteCopiedRecords: enabled => ipcRenderer.invoke(CHANNELS.setPromoteCopiedRecords, enabled),
  setTimeFormat: format => ipcRenderer.invoke(CHANNELS.setTimeFormat, format),
  resetSettings: () => ipcRenderer.invoke(CHANNELS.resetSettings),
  setPinned: (id, pinned) => ipcRenderer.invoke(CHANNELS.setPinned, { id, pinned }),
  clearHistory: () => ipcRenderer.invoke(CHANNELS.clearHistory),
  exportHistory: () => ipcRenderer.invoke(CHANNELS.exportHistory),
  importHistory: includeSettings => ipcRenderer.invoke(CHANNELS.importHistory, includeSettings),
  setShortcuts: shortcuts => ipcRenderer.invoke(CHANNELS.setShortcuts, shortcuts),
  setShortcutCapture: active => ipcRenderer.invoke(CHANNELS.setShortcutCapture, active),
  hideWindow: () => ipcRenderer.invoke(CHANNELS.hideWindow),
  openFullWindow: () => ipcRenderer.invoke(CHANNELS.openFullWindow),
  setPreviewFullscreen: fullscreen => ipcRenderer.invoke(CHANNELS.setPreviewFullscreen, fullscreen),
  onPreviewFullscreenChanged: callback => subscribe<boolean>(CHANNELS.previewFullscreenChanged, callback),
  onWindowShown: callback => subscribe<void>(CHANNELS.windowShown, callback),
  onQuickPickChanged: callback => subscribe<boolean>(CHANNELS.quickPickChanged, callback),
  onQuickPickAction: callback => subscribe<QuickPickAction>(CHANNELS.quickPickAction, callback),
}
contextBridge.exposeInMainWorld('electronAPI', api)
