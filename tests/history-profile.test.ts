import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { existingHistoryProfile, HISTORY_FILENAME, LEGACY_PROFILE_NAME } from '../electron/main/historyProfile'

let appData: string
let currentProfile: string
let legacyProfile: string

beforeEach(() => {
  appData = mkdtempSync(path.join(os.tmpdir(), 'clipclip-history-profile-'))
  currentProfile = path.join(appData, 'ClipClip')
  legacyProfile = path.join(appData, LEGACY_PROFILE_NAME)
  mkdirSync(currentProfile)
  mkdirSync(legacyProfile)
})

afterEach(() => rmSync(appData, { recursive: true, force: true }))

it('uses the branded folder when neither profile contains history', () => {
  expect(existingHistoryProfile(appData, currentProfile)).toBe(currentProfile)
})

it('keeps the complete legacy profile when only it contains history', () => {
  writeFileSync(path.join(legacyProfile, HISTORY_FILENAME), 'legacy fixture')
  expect(existingHistoryProfile(appData, currentProfile)).toBe(legacyProfile)
})

it('prioritizes an existing branded history over a legacy history', () => {
  writeFileSync(path.join(currentProfile, HISTORY_FILENAME), 'current fixture')
  writeFileSync(path.join(legacyProfile, HISTORY_FILENAME), 'legacy fixture')
  expect(existingHistoryProfile(appData, currentProfile)).toBe(currentProfile)
})
