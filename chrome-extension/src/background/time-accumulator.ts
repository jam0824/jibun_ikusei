import { getLocal, setLocal } from '@ext/lib/storage'
import type { DailyProgress, DomainTimeEntry } from '@ext/types/browsing'

const STORAGE_KEY = 'dailyProgress'

function getTodayString(): string {
  return new Date().toISOString().split('T')[0]
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

export class TimeAccumulator {
  /** Get today's progress, resetting if the date has changed */
  async getDailyProgress(): Promise<DailyProgress> {
    const today = getTodayString()
    const stored = await getLocal<DailyProgress>(STORAGE_KEY)

    if (stored && stored.date === today) {
      return stored
    }

    // Date changed or no data — create fresh progress
    const fresh = createEmptyProgress(today)
    await setLocal(STORAGE_KEY, fresh)
    return fresh
  }

  /** Add browsing time for a domain */
  async addTime(
    domain: string,
    cacheKey: string,
    seconds: number,
    isGrowth: boolean,
    isBlocklisted: boolean,
  ): Promise<DailyProgress> {
    const progress = await this.getDailyProgress()

    // Update or create domain time entry
    const existing = progress.domainTimes[cacheKey]
    if (existing) {
      // If category changed (e.g. blocklist updated), move existing seconds
      if (existing.isGrowth !== isGrowth || existing.isBlocklisted !== isBlocklisted) {
        adjustAggregate(progress, existing.isGrowth, existing.isBlocklisted, -existing.totalSeconds)
        existing.isGrowth = isGrowth
        existing.isBlocklisted = isBlocklisted
        adjustAggregate(progress, isGrowth, isBlocklisted, existing.totalSeconds)
      }
      existing.totalSeconds += seconds
      existing.lastUpdated = new Date().toISOString()
    } else {
      const entry: DomainTimeEntry = {
        domain,
        cacheKey,
        category: 'その他',
        isGrowth,
        isBlocklisted,
        totalSeconds: seconds,
        lastUpdated: new Date().toISOString(),
      }
      progress.domainTimes[cacheKey] = entry
    }

    // Add new seconds to aggregate
    adjustAggregate(progress, isGrowth, isBlocklisted, seconds)

    await setLocal(STORAGE_KEY, progress)
    return progress
  }

  /** Update progress fields via a mutation callback */
  async updateProgress(mutator: (progress: DailyProgress) => void): Promise<DailyProgress> {
    const progress = await this.getDailyProgress()
    mutator(progress)
    await setLocal(STORAGE_KEY, progress)
    return progress
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
