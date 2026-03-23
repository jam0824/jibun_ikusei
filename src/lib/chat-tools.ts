import { getDayKey } from '@/lib/date'
import { subDays } from 'date-fns'
import { getBrowsingTimes } from '@/lib/api-client'
import { aggregateDomains, aggregateByCategory } from '@/lib/browsing-aggregator'
import { formatSeconds } from '@/lib/time-format'

export const CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_browsing_times',
      description: 'ユーザーのWeb閲覧時間データを取得する。カテゴリ別・サイト別の内訳を確認できる。',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'week', 'month'],
            description: '取得する期間。today=今日、week=直近7日、month=直近30日',
          },
        },
        required: ['period'],
      },
    },
  },
]

function getDateRange(period: string): { from: string; to: string } {
  const now = new Date()
  const to = getDayKey(now)

  if (period === 'week') {
    return { from: getDayKey(subDays(now, 6)), to }
  }

  if (period === 'month') {
    return { from: getDayKey(subDays(now, 30)), to }
  }

  // today
  return { from: to, to }
}

const PERIOD_LABELS: Record<string, string> = {
  today: '今日',
  week: '直近7日間',
  month: '直近30日間',
}

async function executeGetBrowsingTimes(args: Record<string, unknown>): Promise<string> {
  const period = (args.period as string) ?? 'today'
  const { from, to } = getDateRange(period)

  let entries
  try {
    entries = await getBrowsingTimes(from, to)
  } catch {
    return '閲覧時間データの取得に失敗しました。'
  }

  if (entries.length === 0) {
    return `${PERIOD_LABELS[period] ?? period}の閲覧データがありません。`
  }

  const totalSeconds = entries.reduce((sum, e) => sum + e.totalSeconds, 0)
  const categories = aggregateByCategory(entries)
  const domains = aggregateDomains(entries, 10)

  const lines: string[] = []
  lines.push(`【${PERIOD_LABELS[period] ?? period}のブラウジング時間】`)
  lines.push(`合計: ${formatSeconds(totalSeconds)}`)
  lines.push('')

  lines.push('■ カテゴリ別')
  for (const cat of categories) {
    const growth = cat.isGrowth ? '（成長系）' : ''
    lines.push(`- ${cat.category}: ${formatSeconds(cat.totalSeconds)}${growth}`)
  }
  lines.push('')

  lines.push('■ サイト別')
  for (const d of domains) {
    lines.push(`- ${d.domain}: ${formatSeconds(d.totalSeconds)}（${d.category}）`)
  }

  return lines.join('\n')
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'get_browsing_times') {
    return executeGetBrowsingTimes(args)
  }

  return `不明なツール: ${name}`
}
