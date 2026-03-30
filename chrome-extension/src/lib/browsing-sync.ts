import type {
  BrowsingTimeSyncBacklog,
  BrowsingTimeSyncEntry,
  DailyProgress,
} from '@ext/types/browsing'

export const BROWSING_SYNC_BACKLOG_KEY = 'browsingTimeSyncBacklog'
export const LEGACY_BROWSING_SYNCED_DATES_KEY = 'browsingTimeSyncedDates'

export function createEmptyBrowsingSyncBacklog(): BrowsingTimeSyncBacklog {
  return {}
}

export function progressToSyncEntry(progress: DailyProgress): BrowsingTimeSyncEntry {
  const domains: BrowsingTimeSyncEntry['domains'] = {}
  let totalSeconds = 0

  for (const entry of Object.values(progress.domainTimes)) {
    if (entry.isBlocklisted) continue

    const existing = domains[entry.domain]
    if (existing) {
      existing.totalSeconds += entry.totalSeconds
    } else {
      domains[entry.domain] = {
        totalSeconds: entry.totalSeconds,
        category: entry.category,
        isGrowth: entry.isGrowth,
      }
    }

    totalSeconds += entry.totalSeconds
  }

  return { date: progress.date, domains, totalSeconds }
}

export function sortSyncEntries(entries: BrowsingTimeSyncEntry[]): BrowsingTimeSyncEntry[] {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date))
}
