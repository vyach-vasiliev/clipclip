import { spawn } from 'node:child_process'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = await mkdtemp(path.join(tmpdir(), 'clipclip-electron-test-'))
const output = path.join(root, 'test-results')
await mkdir(output, { recursive: true })
const environment = { ...process.env, CLIPCLIP_TEST_MODE: '1', CLIPCLIP_TEST_USER_DATA: profile, CLIPCLIP_TEST_OUTPUT: output }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.VITE_DEV_SERVER_URL
const child = spawn(electron, ['--disable-gpu', path.join(root, 'scripts/electron-smoke-driver.mjs')], {
  cwd: root, env: environment, stdio: 'inherit', windowsHide: true,
})
const timeout = setTimeout(() => { console.error('Electron smoke test timed out'); child.kill(); }, 60_000)
child.once('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1 })
child.once('exit', code => { clearTimeout(timeout); process.exitCode = code === 0 ? 0 : 1 })
