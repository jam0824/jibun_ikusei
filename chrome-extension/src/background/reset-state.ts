import { BROWSING_SYNC_BACKLOG_KEY, LEGACY_BROWSING_SYNCED_DATES_KEY } from '@ext/lib/browsing-sync'
import { removeLocalKeys } from '@ext/lib/storage'

export const SYNC_STATE_KEYS = [
  'syncQueue',
  'activityLogBuffer',
  'dailyProgress',
  'dailyProgressHistory',
  'weeklyReport',
  BROWSING_SYNC_BACKLOG_KEY,
  LEGACY_BROWSING_SYNCED_DATES_KEY,
] as const

export const RESET_EXTENSION_DATA_KEYS = [
  ...SYNC_STATE_KEYS,
  'classificationCache',
] as const

export async function clearSyncState(): Promise<void> {
  await removeLocalKeys(SYNC_STATE_KEYS)
}

export async function resetExtensionData(): Promise<void> {
  await removeLocalKeys(RESET_EXTENSION_DATA_KEYS)
}
