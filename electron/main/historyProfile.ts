import { existsSync } from 'node:fs'
import path from 'node:path'

export const HISTORY_FILENAME = 'history.enc'
export const LEGACY_PROFILE_NAME = 'electron-vue-vite'

export function existingHistoryProfile(appData: string, currentProfile: string): string {
  if (existsSync(path.join(currentProfile, HISTORY_FILENAME))) return currentProfile
  const legacyProfile = path.join(appData, LEGACY_PROFILE_NAME)
  return existsSync(path.join(legacyProfile, HISTORY_FILENAME)) ? legacyProfile : currentProfile
}
