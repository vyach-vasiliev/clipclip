import type { ElectronAPI } from '../shared/clipboard'
export {}
declare global {
  interface Window { electronAPI?: ElectronAPI }
}
