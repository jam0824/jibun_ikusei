import type {
  ClassificationResult,
  DailyProgress,
  DomainTimeEntry,
  PageInfo,
} from '@ext/types/browsing'
import { toJstIsoString } from '@ext/lib/jst-time'

export function createMockPageInfo(overrides: Partial<PageInfo> = {}): PageInfo {
  return {
    domain: 'example.com',
    url: 'https://example.com/page',
    title: 'Example Page',
    ...overrides,
  }
}

export function createMockClassificationResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    category: '学習',
    isGrowth: true,
    confidence: 0.9,
    suggestedQuestTitle: 'プログラミング学習',
    suggestedSkill: 'プログラミング',
    cacheKey: 'example.com:/page',
    ...overrides,
  }
}

export function createMockDomainTimeEntry(
  overrides: Partial<DomainTimeEntry> = {},
): DomainTimeEntry {
  return {
    domain: 'example.com',
    cacheKey: 'example.com:/page',
    category: '学習',
    isGrowth: true,
    isBlocklisted: false,
    totalSeconds: 0,
    lastUpdated: toJstIsoString(),
    ...overrides,
  }
}

export function createMockDailyProgress(overrides: Partial<DailyProgress> = {}): DailyProgress {
  return {
    date: todayString(),
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
    ...overrides,
  }
}

export function createMockAuthState(expiresInSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  const payload = btoa(JSON.stringify({ exp }))
  const idToken = `header.${payload}.signature`
  return { idToken, email: 'test@example.com', loggedInAt: toJstIsoString() }
}

export function todayString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
