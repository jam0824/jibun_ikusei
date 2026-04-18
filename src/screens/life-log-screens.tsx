import React, { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Globe, Heart, Settings2, Utensils } from 'lucide-react'
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import type { FitbitSummary } from '@/lib/api-client'
import type { MealType, NutrientEntry, NutrientLabel } from '@/domain/types'
import { NUTRIENT_META } from '@/domain/nutrition-constants'
import { resolveDayNutrition } from '@/domain/nutrition-logic'
import { Screen } from '@/components/layout'
import { Button } from '@/components/ui'
import { BrowsingTimeView } from '@/screens/browsing-time-view'
import { useAppStore } from '@/store/app-store'

const BAR_COLORS: Record<NutrientLabel, string> = {
  不足: 'bg-blue-400',
  適正: 'bg-green-400',
  過剰: 'bg-red-400',
}

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  daily: '1日分',
  breakfast: '朝',
  lunch: '昼',
  dinner: '夜',
}

function getTodayJst(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDateJst(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  const ny = next.getFullYear()
  const nm = String(next.getMonth() + 1).padStart(2, '0')
  const nd = String(next.getDate()).padStart(2, '0')
  return `${ny}-${nm}-${nd}`
}

function LifeLogNav({
  date,
  browsingPeriod = 'day',
}: {
  date: string
  browsingPeriod?: string
}) {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? 'inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm shadow-violet-100/80'
      : 'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm'

  return (
    <div className="scrollbar-hide mb-4 flex gap-2 overflow-x-auto pb-1">
      <NavLink
        to={`/records/life/nutrition?date=${date}`}
        className={navClass}
      >
        <Utensils className="h-4 w-4" />
        栄養
      </NavLink>
      <NavLink
        to={`/records/life/health?date=${date}`}
        className={navClass}
      >
        <Heart className="h-4 w-4" />
        健康
      </NavLink>
      <NavLink
        to={`/records/life/browsing?period=${browsingPeriod}&date=${date}`}
        className={navClass}
      >
        <Globe className="h-4 w-4" />
        閲覧
      </NavLink>
    </div>
  )
}

function DateNavigation({
  date,
  onChange,
}: {
  date: string
  onChange: (nextDate: string) => void
}) {
  const dateInputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(shiftDate(date, -1))}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-violet-200 hover:text-violet-600"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => dateInputRef.current?.showPicker()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-violet-200 hover:bg-violet-50/40"
        >
          <CalendarDays className="h-4 w-4 text-violet-500" />
          {formatDateJst(date)}
        </button>
        <button
          type="button"
          onClick={() => onChange(shiftDate(date, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-violet-200 hover:text-violet-600"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <input
        ref={dateInputRef}
        type="date"
        value={date}
        onChange={(event) => onChange(event.target.value)}
        className="absolute h-0 w-0 pointer-events-none opacity-0"
      />
    </>
  )
}

function calcBarWidth(entry: NutrientEntry): number {
  const { value, threshold } = entry
  if (value === null || !threshold) return 0
  const ref =
    threshold.type === 'range'
      ? threshold.upper
      : threshold.type === 'min_only'
        ? threshold.lower
        : threshold.upper
  if (!ref) return 0
  return Math.min((value / ref) * 100, 100)
}

function formatNutrientValue(entry: NutrientEntry): string {
  return entry.value !== null ? `${entry.value} ${entry.unit}` : '未取得'
}

function formatNutrientThreshold(entry: NutrientEntry): string {
  const threshold = entry.threshold
  if (!threshold) return '基準: 未取得'

  if (threshold.type === 'range' && threshold.lower !== undefined && threshold.upper !== undefined) {
    return `基準: ${threshold.lower}〜${threshold.upper} ${entry.unit}`
  }

  if (threshold.type === 'min_only' && threshold.lower !== undefined) {
    return `基準: ${threshold.lower}以上 ${entry.unit}`
  }

  if (threshold.type === 'max_only' && threshold.upper !== undefined) {
    return `基準: ${threshold.upper}未満 ${entry.unit}`
  }

  return '基準: 未取得'
}

export function NutritionLogScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const date = searchParams.get('date') ?? getTodayJst()
  const [isLoading, setIsLoading] = useState(false)
  const { fetchNutrition, nutritionCache } = useAppStore(
    useShallow((s) => ({ fetchNutrition: s.fetchNutrition, nutritionCache: s.nutritionCache })),
  )

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setIsLoading(true)
      fetchNutrition(date)
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) {
            setIsLoading(false)
          }
        })
    })

    return () => {
      cancelled = true
    }
  }, [date, fetchNutrition])

  const dayData = nutritionCache[date]
  const mealRecords = dayData
    ? [dayData.breakfast, dayData.lunch, dayData.dinner].filter(
        (record): record is NonNullable<typeof record> => record !== null,
      )
    : []
  const resolved = dayData ? resolveDayNutrition(dayData.daily, mealRecords) : null
  const sourceLabel =
    dayData?.daily
      ? `表示元: ${MEAL_TYPE_LABELS.daily}`
      : mealRecords.length > 0 && resolved && resolved.mealType !== 'daily'
        ? `表示元: 最新登録データ（${MEAL_TYPE_LABELS[resolved.mealType]})`
        : null

  return (
    <Screen
      title="生活ログ"
      subtitle="栄養の記録を日付ごとに確認できます。"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <LifeLogNav date={date} />
      <DateNavigation date={date} onChange={(nextDate) => setSearchParams({ date: nextDate })} />

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-400">
          <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-violet-500" />
          読み込み中...
        </div>
      ) : !resolved ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          この日の栄養データはありません
        </div>
      ) : (
        <div className="space-y-3 pb-6">
          {sourceLabel ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
              {sourceLabel}
            </div>
          ) : null}

          {NUTRIENT_META.map((meta) => {
            const entry = resolved.nutrients[meta.key]
            const pct = calcBarWidth(entry)
            const barColor = entry.label ? BAR_COLORS[entry.label] : 'bg-slate-300'

            return (
              <div key={meta.key} className="flex items-start gap-3">
                <div className="w-20 shrink-0 pt-1 text-xs text-slate-600">{meta.name}</div>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="overflow-hidden rounded-full bg-slate-100" style={{ height: '7px' }}>
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="w-28 shrink-0 text-right">
                  <div className="text-xs font-medium text-slate-600">{formatNutrientValue(entry)}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-slate-400">
                    {formatNutrientThreshold(entry)}
                  </div>
                </div>
              </div>
            )
          })}

          <div className="flex items-center gap-4 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-full bg-blue-400" />
              不足
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-full bg-green-400" />
              適正
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-full bg-red-400" />
              過剰
            </span>
          </div>
        </div>
      )}
    </Screen>
  )
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

function formatTime(isoTime: string): string {
  return isoTime.slice(11, 16)
}

function HealthDataRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-900">{value ?? '—'}</span>
    </div>
  )
}

function HealthSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  )
}

export function HealthLogScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const date = searchParams.get('date') ?? getTodayJst()
  const [isLoading, setIsLoading] = useState(false)

  const { fetchFitbit, fitbitCache } = useAppStore(
    useShallow((s) => ({ fetchFitbit: s.fetchFitbit, fitbitCache: s.fitbitCache })),
  )

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setIsLoading(true)
      fetchFitbit(date)
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) {
            setIsLoading(false)
          }
        })
    })

    return () => {
      cancelled = true
    }
  }, [date, fetchFitbit])

  const data: FitbitSummary | null | undefined = fitbitCache[date]

  return (
    <Screen
      title="生活ログ"
      subtitle="健康の記録を日付ごとに確認できます。"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <LifeLogNav date={date} />
      <DateNavigation date={date} onChange={(nextDate) => setSearchParams({ date: nextDate })} />

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-400">
          <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-violet-500" />
          読み込み中...
        </div>
      ) : !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          この日の健康データはありません
        </div>
      ) : (
        <div className="space-y-3 pb-6">
          {data.activity ? (
            <HealthSection title="活動">
              <HealthDataRow label="歩数" value={data.activity.steps !== null ? `${data.activity.steps.toLocaleString()} 歩` : null} />
              <HealthDataRow label="距離" value={data.activity.distance !== null ? `${data.activity.distance} km` : null} />
              <HealthDataRow label="消費カロリー" value={data.activity.calories !== null ? `${data.activity.calories} kcal` : null} />
              <HealthDataRow label="活発な運動" value={data.activity.very_active_minutes !== null ? formatMinutes(data.activity.very_active_minutes) : null} />
              <HealthDataRow label="適度な運動" value={data.activity.fairly_active_minutes !== null ? formatMinutes(data.activity.fairly_active_minutes) : null} />
              <HealthDataRow label="軽い運動" value={data.activity.lightly_active_minutes !== null ? formatMinutes(data.activity.lightly_active_minutes) : null} />
              <HealthDataRow label="座位時間" value={data.activity.sedentary_minutes !== null ? formatMinutes(data.activity.sedentary_minutes) : null} />
            </HealthSection>
          ) : null}

          {data.heart ? (
            <HealthSection title="心拍数">
              <HealthDataRow label="安静時心拍数" value={data.heart.resting_heart_rate !== null ? `${data.heart.resting_heart_rate} bpm` : null} />
              {data.heart.heart_zones.map((zone) => (
                <HealthDataRow key={zone.name} label={zone.name} value={`${zone.minutes} 分`} />
              ))}
            </HealthSection>
          ) : null}

          {data.active_zone_minutes ? (
            <HealthSection title="アクティブゾーン分">
              <HealthDataRow
                label="合計推定値"
                value={
                  data.active_zone_minutes.minutes_total_estimate !== null
                    ? formatMinutes(data.active_zone_minutes.minutes_total_estimate)
                    : null
                }
              />
            </HealthSection>
          ) : null}

          {data.sleep?.main_sleep ? (
            <HealthSection title="睡眠">
              <HealthDataRow label="就寝時刻" value={formatTime(data.sleep.main_sleep.start_time)} />
              <HealthDataRow label="起床時刻" value={formatTime(data.sleep.main_sleep.end_time)} />
              <HealthDataRow label="睡眠時間" value={formatMinutes(data.sleep.main_sleep.minutes_asleep)} />
              <HealthDataRow label="深い睡眠" value={data.sleep.main_sleep.deep_minutes !== null ? formatMinutes(data.sleep.main_sleep.deep_minutes) : null} />
              <HealthDataRow label="レム睡眠" value={data.sleep.main_sleep.rem_minutes !== null ? formatMinutes(data.sleep.main_sleep.rem_minutes) : null} />
              <HealthDataRow label="浅い睡眠" value={data.sleep.main_sleep.light_minutes !== null ? formatMinutes(data.sleep.main_sleep.light_minutes) : null} />
              <HealthDataRow label="覚醒時間" value={formatMinutes(data.sleep.main_sleep.minutes_awake)} />
            </HealthSection>
          ) : null}
        </div>
      )}
    </Screen>
  )
}

export function BrowsingLogScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const date = searchParams.get('date') ?? getTodayJst()
  const period = searchParams.get('period') ?? 'day'

  return (
    <Screen
      title="生活ログ"
      subtitle="閲覧の記録を期間ごとに確認できます。"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <LifeLogNav date={date} browsingPeriod={period} />
      <DateNavigation
        date={date}
        onChange={(nextDate) => {
          const next = new URLSearchParams(searchParams)
          next.set('date', nextDate)
          setSearchParams(next)
        }}
      />
      <div className="pb-6">
        <BrowsingTimeView />
      </div>
    </Screen>
  )
}
