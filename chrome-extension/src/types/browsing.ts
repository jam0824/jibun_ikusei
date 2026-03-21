export type BrowsingCategory = '学習' | '仕事' | '健康' | '生活' | '創作' | '対人' | '娯楽' | 'その他'

export const GROWTH_CATEGORIES: readonly BrowsingCategory[] = ['学習', '仕事', '健康', '生活', '創作', '対人']
export const NON_GROWTH_CATEGORIES: readonly BrowsingCategory[] = ['娯楽', 'その他']

export function isGrowthCategory(category: BrowsingCategory): boolean {
  return (GROWTH_CATEGORIES as readonly string[]).includes(category)
}

/** Page metadata extracted by content script */
export interface PageInfo {
  domain: string
  url: string
  title: string
  description?: string
  channelOrAuthor?: string
  sectionHint?: string
}

/** AI classification result */
export interface ClassificationResult {
  category: BrowsingCategory
  isGrowth: boolean
  confidence: number
  suggestedQuestTitle: string
  suggestedSkill: string
  cacheKey: string
}

/** Cached classification entry */
export interface ClassificationCacheEntry {
  result: ClassificationResult
  source: 'ai' | 'manual' | 'server'
  createdAt: string
  expiresAt: string
}

/** Time tracked per domain+classification per day */
export interface DomainTimeEntry {
  domain: string
  cacheKey: string
  category: BrowsingCategory
  isGrowth: boolean
  isBlocklisted: boolean
  totalSeconds: number
  lastUpdated: string
}

/** Today's aggregated progress */
export interface DailyProgress {
  date: string
  goodBrowsingSeconds: number
  badBrowsingSeconds: number
  otherBrowsingSeconds: number
  goodQuestsCleared: number
  badQuestsTriggered: number
  xpGained: number
  xpLost: number
  lastGoodRewardAtSeconds: number
  lastBadPenaltyAtSeconds: number
  warningShownDomains: string[]
  domainTimes: Record<string, DomainTimeEntry>
}

/** Weekly report structure */
export interface WeeklyReport {
  weekKey: string
  totalMinutes: number
  goodMinutes: number
  badMinutes: number
  categoryBreakdown: Record<BrowsingCategory, number>
  topGrowthDomains: Array<{ domain: string; minutes: number }>
  goodQuestsCleared: number
  badQuestsTriggered: number
  lilyComment: string
  generatedAt: string
}

/** Browsing quest XP constants */
export const BROWSING_XP = {
  GOOD_REWARD: 2,
  BAD_PENALTY: 5,
  FIRST_GOOD_THRESHOLD_SECONDS: 30 * 60,
  GOOD_INTERVAL_SECONDS: 60 * 60,
  WARNING_THRESHOLD_SECONDS: 50 * 60,
  BAD_THRESHOLD_SECONDS: 60 * 60,
  BAD_INTERVAL_SECONDS: 60 * 60,
} as const
