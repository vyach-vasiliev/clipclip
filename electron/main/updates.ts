import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

export async function startWindowsUpdates() {
  if (process.platform !== 'win32' || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return
  if (!existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return

  const { default: { autoUpdater } } = await import('electron-updater')
  autoUpdater.allowPrerelease = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.on('error', error => console.warn('ClipClip update failed:', error.message))

  async function check() {
    try {
      const result = await autoUpdater.checkForUpdates()
      await result?.downloadPromise
    } catch { /* The updater emits the error and the next scheduled check can retry. */ }
  }

  const timer = setInterval(() => { void check() }, UPDATE_INTERVAL_MS).unref()
  autoUpdater.once('update-downloaded', () => clearInterval(timer))
  await check()
}
