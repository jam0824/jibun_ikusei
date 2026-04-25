import {
  BROWSING_SYNC_BACKLOG_KEY,
  createEmptyBrowsingSyncBacklog,
  progressToSyncEntry,
} from '@ext/lib/browsing-sync'
import { transactLocal } from '@ext/lib/storage'
import { toJstIsoString } from '@ext/lib/jst-time'
import {
  OTHER_BROWSING_CATEGORY,
  type BrowsingCategory,
  type BrowsingTimeSyncBacklog,
  type DailyProgress,
  type DomainTimeEntry,
} from '@ext/types/browsing'

const STORAGE_KEY = 'dailyProgress'
const HISTORY_KEY = 'dailyProgressHistory'
const MAX_HISTORY_DAYS = 7

interface ProgressTransactionStore {
  [STORAGE_KEY]: DailyProgress | null
  [HISTORY_KEY]: DailyProgress[]
  [BROWSING_SYNC_BACKLOG_KEY]: BrowsingTimeSyncBacklog
}

function getTodayString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createEmptyProgress(date: string): DailyProgress {
  return {
    date,
    goodBrowsingSeconds: 0,
    badBrowsingSeconds: 0,
    otherBrowsingSeconds: 0,
    goodQuestsCleared: 0,
    badQuestsTriggered: 0,
    xpGained: 0,
    xpLost: 0,
    lastGoodRewardAtSeconds: 0,
    lastBadPenaltyAtSeconds: 0,
    warningShownDomains: [],
    domainTimes: {},
  }
}

function createTransactionDefaults(): ProgressTransactionStore {
  return {
    [STORAGE_KEY]: null,
    [HISTORY_KEY]: [],
    [BROWSING_SYNC_BACKLOG_KEY]: createEmptyBrowsingSyncBacklog(),
  }
}

function archiveProgressHistory(history: DailyProgress[], progress: DailyProgress): DailyProgress[] {
  const nextHistory = history.filter((entry) => entry.date !== progress.date)
  nextHistory.push(progress)
  return nextHistory.slice(-MAX_HISTORY_DAYS)
}

function archiveProgressBacklog(
  backlog: BrowsingTimeSyncBacklog,
  progress: DailyProgress,
): BrowsingTimeSyncBacklog {
  return {
    ...backlog,
    [progress.date]: progressToSyncEntry(progress),
  }
}

function ensureCurrentProgress(store: ProgressTransactionStore): DailyProgress {
  const today = getTodayString()
  const stored = store[STORAGE_KEY]

  if (stored && stored.date === today) {
    return stored
  }

  if (stored) {
    store[HISTORY_KEY] = archiveProgressHistory(store[HISTORY_KEY], stored)
    store[BROWSING_SYNC_BACKLOG_KEY] = archiveProgressBacklog(store[BROWSING_SYNC_BACKLOG_KEY], stored)
  }

  const fresh = createEmptyProgress(today)
  store[STORAGE_KEY] = fresh
  return fresh
}

export class TimeAccumulator {
  /** Get today's progress, resetting if the date has changed */
  async getDailyProgress(): Promise<DailyProgress> {
    return transactLocal(createTransactionDefaults(), (store) => ensureCurrentProgress(store))
  }

  /** Add browsing time for a domain */
  async addTime(
    domain: string,
    cacheKey: string,
    seconds: number,
    isGrowth: boolean,
    isBlocklisted: boolean,
    category: BrowsingCategory = OTHER_BROWSING_CATEGORY,
  ): Promise<DailyProgress> {
    return transactLocal(createTransactionDefaults(), (store) => {
      const progress = ensureCurrentProgress(store)
      const existing = progress.domainTimes[cacheKey]

      if (existing) {
        if (existing.isGrowth !== isGrowth || existing.isBlocklisted !== isBlocklisted) {
          adjustAggregate(progress, existing.isGrowth, existing.isBlocklisted, -existing.totalSeconds)
          existing.isGrowth = isGrowth
          existing.isBlocklisted = isBlocklisted
          adjustAggregate(progress, isGrowth, isBlocklisted, existing.totalSeconds)
        }

        if (category !== OTHER_BROWSING_CATEGORY) {
          existing.category = category
        }

        existing.totalSeconds += seconds
        existing.lastUpdated = toJstIsoString()
      } else {
        const entry: DomainTimeEntry = {
          domain,
          cacheKey,
          category,
          isGrowth,
          isBlocklisted,
          totalSeconds: seconds,
          lastUpdated: toJstIsoString(),
        }
        progress.domainTimes[cacheKey] = entry
      }

      adjustAggregate(progress, isGrowth, isBlocklisted, seconds)
      return progress
    })
  }

  /** Update progress fields via a mutation callback */
  async updateProgress(mutator: (progress: DailyProgress) => void): Promise<DailyProgress> {
    return transactLocal(createTransactionDefaults(), (store) => {
      const progress = ensureCurrentProgress(store)
      mutator(progress)
      return progress
    })
  }
}

function adjustAggregate(
  progress: DailyProgress,
  isGrowth: boolean,
  isBlocklisted: boolean,
  seconds: number,
): void {
  if (isGrowth) {
    progress.goodBrowsingSeconds += seconds
  } else if (isBlocklisted) {
    progress.badBrowsingSeconds += seconds
  } else {
    progress.otherBrowsingSeconds += seconds
  }
}
