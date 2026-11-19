import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ElectronAPI, type HistoryState } from '../../shared/clipboard'

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
  checkFiles: id => ipcRenderer.invoke(CHANNELS.checkFiles, id),
  revealFile: (id, index) => ipcRenderer.invoke(CHANNELS.revealFile, { id, index }),
  copyFilePath: (id, index) => ipcRenderer.invoke(CHANNELS.copyFilePath, { id, index }),
  saveTextRevision: (id, text) => ipcRenderer.invoke(CHANNELS.saveTextRevision, { id, text }),
  deleteItem: id => ipcRenderer.invoke(CHANNELS.deleteItem, id),
  undoDelete: () => ipcRenderer.invoke(CHANNELS.undoDelete),
  setPaused: paused => ipcRenderer.invoke(CHANNELS.setPaused, paused),
  setHistoryLimit: limit => ipcRenderer.invoke(CHANNELS.setHistoryLimit, limit),
  setPasteOnSelect: enabled => ipcRenderer.invoke(CHANNELS.setPasteOnSelect, enabled),
  setTimeFormat: format => ipcRenderer.invoke(CHANNELS.setTimeFormat, format),
  resetSettings: () => ipcRenderer.invoke(CHANNELS.resetSettings),
  setPinned: (id, pinned) => ipcRenderer.invoke(CHANNELS.setPinned, { id, pinned }),
  clearHistory: () => ipcRenderer.invoke(CHANNELS.clearHistory),
  exportHistory: () => ipcRenderer.invoke(CHANNELS.exportHistory),
  importHistory: includeSettings => ipcRenderer.invoke(CHANNELS.importHistory, includeSettings),
  setShortcuts: shortcuts => ipcRenderer.invoke(CHANNELS.setShortcuts, shortcuts),
  setShortcutCapture: active => ipcRenderer.invoke(CHANNELS.setShortcutCapture, active),
  hideWindow: () => ipcRenderer.invoke(CHANNELS.hideWindow),
  setPreviewFullscreen: fullscreen => ipcRenderer.invoke(CHANNELS.setPreviewFullscreen, fullscreen),
  onPreviewFullscreenChanged: callback => subscribe<boolean>(CHANNELS.previewFullscreenChanged, callback),
  onWindowShown: callback => subscribe<void>(CHANNELS.windowShown, callback),
}
contextBridge.exposeInMainWorld('electronAPI', api)
