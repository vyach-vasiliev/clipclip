import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import koffi from 'koffi'

export async function checkWindowsClipboardSource(window, root) {
  const source = await readFile(path.join(root, 'electron/main/windowsClipboardSource.ts'), 'utf8')
  const fixturePath = path.join(process.env.CLIPCLIP_TEST_OUTPUT, 'windowsClipboardSource.fixture.mjs')
  await writeFile(fixturePath, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  const { createClipboardOwnerReader, createWindowsClipboardOwnerApi, createWindowsClipboardOwnerListener, WM_CLIPBOARDUPDATE } = await import(pathToFileURL(fixturePath).href)
  const handle = window.getNativeWindowHandle()
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
  const native = createWindowsClipboardOwnerApi()
  // Supply a synthetic owner and sequence: never read or change the system clipboard.
  const reader = createClipboardOwnerReader({ ...native, owner: () => hwnd, sequence: () => 7 }, 0)
  const capture = reader.capture()
  assert.ok(capture, 'Native process/path/window lookup should resolve the synthetic owner')
  assert.equal(capture.source.name.toLowerCase(), path.basename(process.execPath, '.exe').toLowerCase())
  assert.equal(capture.source.title, window.getTitle().slice(0, 2000))
  assert.deepEqual(reader.resolve(capture), capture.source)
  const ownProcess = createClipboardOwnerReader({ ...native, owner: () => hwnd, sequence: () => 7 }, process.pid)
  assert.equal(ownProcess.capture(), undefined)
  const post = koffi.load('user32.dll').func('int __stdcall PostMessageW(uintptr_t hwnd, uint message, uintptr_t wparam, intptr_t lparam)')
  let notifications = 0
  let notifiedSource
  const listener = createWindowsClipboardOwnerListener(window, { capture() {
    notifications++
    notifiedSource = reader.resolve(reader.capture())
  } })
  const initial = notifications
  assert.equal(initial, 1, 'Listener should capture the initial owner metadata')
  try {
    // Exercise the real native listener with a synthetic message, without accessing clipboard contents.
    assert.ok(post(hwnd, WM_CLIPBOARDUPDATE, 0, 0))
    for (let attempt = 0; notifications === initial && attempt < 50; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(notifications > initial, 'Native clipboard notification must reach the metadata reader')
    assert.deepEqual(notifiedSource, capture.source)
  } finally { listener.dispose() }
  const disposed = notifications
  assert.ok(post(hwnd, WM_CLIPBOARDUPDATE, 0, 0))
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(notifications, disposed, 'Disposed listener must not capture more metadata')
  console.log('Native Windows clipboard owner lookup passed with a synthetic owner window.')
  console.log('Native Windows clipboard notification capture and disposal passed.')
}
