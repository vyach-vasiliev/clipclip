import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import koffi from 'koffi'

const [profile, parentArg] = process.argv.slice(-2)
const parentPid = Number(parentArg)
const commandFile = path.join(profile, 'commands.jsonl')
const eventFile = path.join(profile, 'events.jsonl')

function report(type, data) {
  appendFileSync(eventFile, JSON.stringify({ type, ...data }) + '\n')
}

async function run() {
  app.setPath('userData', profile)
  report('started')
  await app.whenReady()
  const user32 = koffi.load('user32.dll')
  const allowForeground = user32.func('int __stdcall AllowSetForegroundWindow(uint32_t pid)')
  const window = new BrowserWindow({ show: false, title: 'Synthetic paste target', webPreferences: { sandbox: true } })
  await window.loadURL('data:text/html,<title>Synthetic paste target</title><input autofocus>')
  window.setMenu(null)
  window.webContents.on('before-input-event', (event, input) => {
    if (!input.control || input.code !== 'KeyV') return
    // Report receipt without ever reading or changing the real system clipboard.
    event.preventDefault()
    if (input.type === 'keyDown') report('paste')
  })

  let commandsRead = 0
  const commandTimer = setInterval(() => {
    const commands = readFileSync(commandFile, 'utf8').split('\n').slice(commandsRead, -1)
    for (const entry of commands) {
      commandsRead++
      const { id, type } = JSON.parse(entry)
      if (type === 'quit') { app.quit(); return }
      if (type === 'grant') report('grant', { id, granted: Boolean(allowForeground(parentPid)) })
    }
  }, 40)
  const parentTimer = setInterval(() => {
    try { process.kill(parentPid, 0) }
    catch (error) { if (error.code === 'ESRCH') app.quit() }
  }, 1000)
  app.once('before-quit', () => { clearInterval(commandTimer); clearInterval(parentTimer) })
  window.show()
  window.focus()
  const handle = window.getNativeWindowHandle()
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
  report('ready', { hwnd: String(hwnd), pid: process.pid })
}

// Electron emits ready after evaluating the ESM entrypoint.
void run().catch(error => {
  report('error', { error: String(error.stack ?? error) })
  app.exit(1)
})
