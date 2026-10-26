import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

export async function checkWindowsClipboardSource(window, root) {
  const source = await readFile(path.join(root, 'electron/main/windowsClipboardSource.ts'), 'utf8')
  const fixturePath = path.join(process.env.CLIPCLIP_TEST_OUTPUT, 'windowsClipboardSource.fixture.mjs')
  await writeFile(fixturePath, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  const { createClipboardOwnerReader, createWindowsClipboardOwnerApi } = await import(pathToFileURL(fixturePath).href)
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
  console.log('Native Windows clipboard owner lookup passed with a synthetic owner window.')
}
