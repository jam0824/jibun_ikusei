import type { ClassificationResult, DailyProgress, DomainTimeEntry, PageInfo } from '@ext/types/browsing'

export function createMockPageInfo(overrides: Partial<PageInfo> = {}): PageInfo {
  return {
    domain: 'example.com',
    url: 'https://example.com/page',
    title: 'Example Page',
    ...overrides,
  }
}

export function createMockClassificationResult(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
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

export function createMockDomainTimeEntry(overrides: Partial<DomainTimeEntry> = {}): DomainTimeEntry {
  return {
    domain: 'example.com',
    cacheKey: 'example.com:/page',
    category: '学習',
    isGrowth: true,
    isBlocklisted: false,
    totalSeconds: 0,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  }
}

export function createMockDailyProgress(overrides: Partial<DailyProgress> = {}): DailyProgress {
  return {
    date: new Date().toISOString().split('T')[0],
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

/** Get today's date string in YYYY-MM-DD format */
export function todayString(): string {
  return new Date().toISOString().split('T')[0]
}
