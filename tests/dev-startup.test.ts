import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import config from '../vite.config'

type StartupContext = { startup: (argv: string[]) => void; reload: () => void }
const captured = vi.hoisted(() => ({ options: null as null | {
  main: { onstart: (context: StartupContext) => void }
  preload: { onstart: (context: StartupContext) => void }
} }))
vi.mock('vite-plugin-electron/simple', () => ({ default: (options: typeof captured.options) => {
  captured.options = options
  return []
} }))
const previous = process.electronApp
beforeEach(() => {
  vi.stubEnv('VSCODE_DEBUG', '')
  process.electronApp = undefined
  if (typeof config !== 'function') throw new Error('Expected a configuration factory')
  config({ command: 'serve', mode: 'test' })
})
afterEach(() => { process.electronApp = previous; vi.unstubAllEnvs() })

describe('development startup', () => {
  it('uses sandboxed arguments for both initial startup paths', () => {
    const startup = vi.fn(), reload = vi.fn()
    captured.options!.main.onstart({ startup, reload })
    captured.options!.preload.onstart({ startup, reload })
    expect(startup.mock.calls).toEqual([[['.']], [['.']]])
  })
  it('reloads an existing app instead of starting another instance', () => {
    process.electronApp = {} as ChildProcess
    const startup = vi.fn(), reload = vi.fn()
    captured.options!.preload.onstart({ startup, reload })
    expect(reload).toHaveBeenCalledOnce()
    expect(startup).not.toHaveBeenCalled()
  })
  it('leaves debugger-controlled launches to the debugger', () => {
    vi.stubEnv('VSCODE_DEBUG', '1')
    const startup = vi.fn(), reload = vi.fn()
    captured.options!.main.onstart({ startup, reload })
    captured.options!.preload.onstart({ startup, reload })
    expect(startup).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
