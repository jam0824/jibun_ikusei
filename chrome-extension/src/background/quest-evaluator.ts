import type { DailyProgress } from '@ext/types/browsing'
import { BROWSING_XP } from '@ext/types/browsing'

export interface QuestEvent {
  type: 'good_quest' | 'bad_quest' | 'warning'
  xp: number
  domain?: string
  message?: string
}

interface EvaluateOptions {
  currentXp?: number
}

/**
 * Evaluate daily progress and return any triggered events.
 * This is a pure function — it does not mutate the progress object.
 *
 * @param progress - Current daily progress
 * @param blocklist - Not used directly here (blocklist is applied during time accumulation)
 * @param options - Optional: currentXp to cap penalties
 */
export function evaluateProgress(
  progress: DailyProgress,
  _blocklist: string[],
  options: EvaluateOptions = {},
): QuestEvent[] {
  const events: QuestEvent[] = []
  const { currentXp = Infinity } = options

  // --- Good browsing quests ---
  evaluateGoodQuests(progress, events)

  // --- Bad browsing warnings ---
  evaluateWarnings(progress, events)

  // --- Bad browsing penalties ---
  evaluateBadQuests(progress, events, currentXp)

  return events
}

function evaluateGoodQuests(progress: DailyProgress, events: QuestEvent[]): void {
  const { goodBrowsingSeconds, lastGoodRewardAtSeconds } = progress
  const { FIRST_GOOD_THRESHOLD_SECONDS, GOOD_INTERVAL_SECONDS, GOOD_REWARD } = BROWSING_XP

  // Calculate next threshold
  let nextThreshold: number
  if (lastGoodRewardAtSeconds === 0) {
    nextThreshold = FIRST_GOOD_THRESHOLD_SECONDS
  } else {
    nextThreshold = lastGoodRewardAtSeconds + GOOD_INTERVAL_SECONDS
  }

  if (goodBrowsingSeconds >= nextThreshold) {
    events.push({
      type: 'good_quest',
      xp: GOOD_REWARD,
    })
  }
}

function evaluateWarnings(progress: DailyProgress, events: QuestEvent[]): void {
  const { WARNING_THRESHOLD_SECONDS } = BROWSING_XP
  const { domainTimes, warningShownDomains } = progress

  // Check each blocklisted non-growth domain
  // Aggregate by domain (not cacheKey)
  const domainSeconds: Record<string, number> = {}
  for (const entry of Object.values(domainTimes)) {
    if (entry.isBlocklisted && !entry.isGrowth) {
      domainSeconds[entry.domain] = (domainSeconds[entry.domain] ?? 0) + entry.totalSeconds
    }
  }

  for (const [domain, totalSeconds] of Object.entries(domainSeconds)) {
    if (totalSeconds >= WARNING_THRESHOLD_SECONDS && !warningShownDomains.includes(domain)) {
      events.push({
        type: 'warning',
        xp: 0,
        domain,
        message: `Lily: もうすぐ1時間です。このまま続けるか、一度切り上げるか考えてみましょう。`,
      })
    }
  }
}

function evaluateBadQuests(progress: DailyProgress, events: QuestEvent[], currentXp: number): void {
  const { badBrowsingSeconds, lastBadPenaltyAtSeconds } = progress
  const { BAD_THRESHOLD_SECONDS, BAD_INTERVAL_SECONDS, BAD_PENALTY } = BROWSING_XP

  // Calculate next threshold
  let nextThreshold: number
  if (lastBadPenaltyAtSeconds === 0) {
    nextThreshold = BAD_THRESHOLD_SECONDS
  } else {
    nextThreshold = lastBadPenaltyAtSeconds + BAD_INTERVAL_SECONDS
  }

  if (badBrowsingSeconds >= nextThreshold) {
    // Cap penalty at current XP (XP floor at 0)
    const penalty = Math.min(BAD_PENALTY, currentXp)
    events.push({
      type: 'bad_quest',
      xp: penalty === 0 ? 0 : -penalty,
    })
  }
}
