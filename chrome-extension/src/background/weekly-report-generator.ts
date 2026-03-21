import type { BrowsingCategory, DailyProgress, WeeklyReport } from '@ext/types/browsing'

const ALL_CATEGORIES: BrowsingCategory[] = ['学習', '仕事', '健康', '生活', '創作', '対人', '娯楽', 'その他']

export function generateWeeklyReport(history: DailyProgress[], weekKey: string): WeeklyReport {
  let totalSeconds = 0
  let goodSeconds = 0
  let badSeconds = 0
  let goodQuestsCleared = 0
  let badQuestsTriggered = 0

  const categorySeconds: Record<string, number> = {}
  for (const cat of ALL_CATEGORIES) {
    categorySeconds[cat] = 0
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
  for (const cat of ALL_CATEGORIES) {
    categoryBreakdown[cat as BrowsingCategory] = Math.floor((categorySeconds[cat] ?? 0) / 60)
  }

  const topGrowthDomains = Object.entries(domainGrowthSeconds)
    .map(([domain, seconds]) => ({ domain, minutes: Math.floor(seconds / 60) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5)

  const lilyComment = generateLilyComment(goodSeconds, badSeconds)

  return {
    weekKey,
    totalMinutes: Math.floor(totalSeconds / 60),
    goodMinutes: Math.floor(goodSeconds / 60),
    badMinutes: Math.floor(badSeconds / 60),
    categoryBreakdown,
    topGrowthDomains,
    goodQuestsCleared,
    badQuestsTriggered,
    lilyComment,
    generatedAt: new Date().toISOString(),
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
  } else if (ratio >= 0.5) {
    return '成長と娯楽のバランスが取れた週でした。もう少し学習時間を増やせるとさらに良いです。'
  } else {
    return '娯楽寄りの閲覧が多い週でした。来週は成長に繋がる閲覧を意識してみましょう。'
  }
}
