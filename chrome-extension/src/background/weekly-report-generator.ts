import { BROWSING_CATEGORIES, type BrowsingCategory, type DailyProgress, type WeeklyReport } from '@ext/types/browsing'
import { toJstIsoString } from '@ext/lib/jst-time'

const ALL_CATEGORIES: BrowsingCategory[] = [...BROWSING_CATEGORIES]

export function generateWeeklyReport(history: DailyProgress[], weekKey: string): WeeklyReport {
  let totalSeconds = 0
  let goodSeconds = 0
  let badSeconds = 0
  let goodQuestsCleared = 0
  let badQuestsTriggered = 0

  const categorySeconds: Record<BrowsingCategory, number> = {} as Record<BrowsingCategory, number>
  for (const category of ALL_CATEGORIES) {
    categorySeconds[category] = 0
  }

  const domainGrowthSeconds: Record<string, number> = {}

  for (const day of history) {
    goodSeconds += day.goodBrowsingSeconds
    badSeconds += day.badBrowsingSeconds
    totalSeconds += day.goodBrowsingSeconds + day.badBrowsingSeconds + day.otherBrowsingSeconds
    goodQuestsCleared += day.goodQuestsCleared
    badQuestsTriggered += day.badQuestsTriggered

    for (const entry of Object.values(day.domainTimes)) {
      categorySeconds[entry.category] = (categorySeconds[entry.category] ?? 0) + entry.totalSeconds
      if (entry.isGrowth) {
        domainGrowthSeconds[entry.domain] = (domainGrowthSeconds[entry.domain] ?? 0) + entry.totalSeconds
      }
    }
  }

  const categoryBreakdown = {} as Record<BrowsingCategory, number>
  for (const category of ALL_CATEGORIES) {
    categoryBreakdown[category] = Math.floor((categorySeconds[category] ?? 0) / 60)
  }

  const topGrowthDomains = Object.entries(domainGrowthSeconds)
    .map(([domain, seconds]) => ({ domain, minutes: Math.floor(seconds / 60) }))
    .sort((left, right) => right.minutes - left.minutes)
    .slice(0, 5)

  return {
    weekKey,
    totalMinutes: Math.floor(totalSeconds / 60),
    goodMinutes: Math.floor(goodSeconds / 60),
    badMinutes: Math.floor(badSeconds / 60),
    categoryBreakdown,
    topGrowthDomains,
    goodQuestsCleared,
    badQuestsTriggered,
    lilyComment: generateLilyComment(goodSeconds, badSeconds),
    generatedAt: toJstIsoString(),
  }
}

function generateLilyComment(goodSeconds: number, badSeconds: number): string {
  const goodMinutes = Math.floor(goodSeconds / 60)
  const badMinutes = Math.floor(badSeconds / 60)

  if (goodMinutes === 0 && badMinutes === 0) {
    return '今週はまだデータがありません。来週はブラウジングを記録してみましょう。'
  }

  const ratio = goodMinutes / (goodMinutes + badMinutes || 1)

  if (ratio >= 0.8) {
    return '今週は成長系の閲覧が安定していました。この調子で続けましょう。'
  }
  if (ratio >= 0.5) {
    return '成長と娯楽のバランスが取れた週でした。もう少し学習時間を増やせるとさらに良いです。'
  }
  return '娯楽寄りの閲覧が多い週でした。来週は成長につながる閲覧を意識してみましょう。'
}
