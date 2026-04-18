import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { getBrowsingTimes } from '@/lib/api-client'
import { aggregateDomains, aggregateByCategory, type BrowsingTimeData } from '@/lib/browsing-aggregator'
import { formatSeconds } from '@/lib/time-format'
import { Card, CardContent } from '@/components/ui'

type Period = 'day' | 'week' | 'month' | 'all'

const periodOptions: Array<{ key: Period; label: string }> = [
  { key: 'day', label: '1日' },
  { key: 'week', label: '1週間' },
  { key: 'month', label: '1ヶ月' },
  { key: 'all', label: '全期間' },
]

function parseDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) {
    return null
  }

  const [, year, month, day] = match
  const parsed = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getLocalDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getDateRange(period: Period, anchorDateKey: string): { from: string; to: string } {
  const anchorDate = parseDateKey(anchorDateKey) ?? new Date()
  const to = getLocalDateString(anchorDate)

  switch (period) {
    case 'day':
      return { from: to, to }
    case 'week': {
      const from = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() - 6)
      return { from: getLocalDateString(from), to }
    }
    case 'month': {
      const from = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() - 29)
      return { from: getLocalDateString(from), to }
    }
    case 'all':
      return { from: '2020-01-01', to }
  }
}

function TooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ value: number }> }) {
  if (!active || !payload?.[0]) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-md">
      {formatSeconds(payload[0].value)}
    </div>
  )
}

export function BrowsingTimeView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedPeriod = searchParams.get('period')
  const requestedDate = searchParams.get('date')
  const period: Period =
    requestedPeriod === 'week' || requestedPeriod === 'month' || requestedPeriod === 'all'
      ? requestedPeriod
      : 'day'
  const anchorDate = requestedDate ?? getLocalDateString(new Date())
  const [data, setData] = useState<BrowsingTimeData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (requestedPeriod === period && requestedDate === anchorDate) {
      return
    }

    const next = new URLSearchParams(searchParams)
    next.set('period', period)
    next.set('date', anchorDate)
    setSearchParams(next, { replace: true })
  }, [anchorDate, period, requestedDate, requestedPeriod, searchParams, setSearchParams])

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true)
    setError(null)
    try {
      const { from, to } = getDateRange(p, anchorDate)
      const result = await getBrowsingTimes(from, to)
      setData(result)
    } catch {
      setError('データの取得に失敗しました')
      setData([])
    } finally {
      setLoading(false)
    }
  }, [anchorDate])

  useEffect(() => {
    fetchData(period)
  }, [period, fetchData])

  const domainData = aggregateDomains(data)
  const categoryData = aggregateByCategory(data)
  const totalSeconds = data.reduce((sum, d) => sum + d.totalSeconds, 0)

  return (
    <div className="space-y-4">
      {/* Period filter */}
      <div className="grid grid-cols-4 gap-2">
        {periodOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.set('period', option.key)
              next.set('date', anchorDate)
              setSearchParams(next)
            }}
            className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
              period === option.key
                ? 'bg-violet-600 text-white shadow-md shadow-violet-200'
                : 'bg-white text-slate-500 hover:bg-violet-50 hover:text-violet-600'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Total summary */}
      <Card className="border-violet-200 bg-violet-50">
        <CardContent className="p-4 text-center">
          <div className="text-xs text-violet-600">合計閲覧時間</div>
          <div className="mt-1 text-2xl font-black text-violet-900">
            {loading ? '...' : formatSeconds(totalSeconds)}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="p-4 text-center text-sm text-rose-600">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && domainData.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            この期間の閲覧データはありません。
          </CardContent>
        </Card>
      )}

      {/* Domain bar chart */}
      {domainData.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              ドメイン別
            </div>
            <ResponsiveContainer width="100%" height={Math.max(200, domainData.length * 32)}>
              <BarChart data={domainData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => formatSeconds(v)}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="domain"
                  width={120}
                  tick={{ fontSize: 11, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<TooltipContent />} cursor={{ fill: 'rgba(139, 92, 246, 0.06)' }} />
                <Bar dataKey="totalSeconds" radius={[0, 6, 6, 0]} barSize={20}>
                  {domainData.map((entry) => (
                    <Cell
                      key={entry.domain}
                      fill={entry.isGrowth ? '#22c55e' : '#94a3b8'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Category bar chart */}
      {categoryData.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              カテゴリ別
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={categoryData} margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => formatSeconds(v)}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<TooltipContent />} cursor={{ fill: 'rgba(139, 92, 246, 0.06)' }} />
                <Bar dataKey="totalSeconds" radius={[6, 6, 0, 0]} barSize={32}>
                  {categoryData.map((entry) => (
                    <Cell
                      key={entry.category}
                      fill={entry.isGrowth ? '#22c55e' : '#94a3b8'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-green-500" />
          <span>成長系</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-slate-400" />
          <span>その他</span>
        </div>
      </div>
    </div>
  )
}
