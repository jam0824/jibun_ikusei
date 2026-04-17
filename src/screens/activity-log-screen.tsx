import { CalendarDays, Clock3, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ActivityLogNav, RecordsSectionTabs } from '@/components/records-navigation'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Input, Switch } from '@/components/ui'
import { formatDateTime } from '@/lib/date'
import { writeLastRecordsRoute } from '@/lib/records-route-state'
import {
  type ActivityDayViewData,
  type ActivityLogViewMode,
  type ActivitySearchResult,
  type ActivityWeekViewData,
  canDeleteActionLogRange,
  deleteActionLogDateRange,
  ensurePreviousDayDailyActivityLog,
  ensurePreviousWeekReviewForWeb,
  exportActionLogBundle,
  fetchActivityCalendarMonth,
  fetchActivityDayView,
  fetchActivityReviewWeek,
  fetchActivityReviewYear,
  getCurrentMonthKeyJst,
  getCurrentWeekKeyJst,
  getCurrentYearJst,
  getTodayDateKeyJst,
  normalizeMonthKey,
  normalizeViewMode,
  normalizeWeekKey,
  normalizeYear,
  searchActivityLogs,
  setActivitySessionHidden,
  shiftMonthKey,
} from '@/lib/action-log-view'
import { useAppStore } from '@/store/app-store'

type ActivityLogVariant = 'today' | 'day' | 'calendar' | 'search' | 'review-year' | 'review-week'

function createDateKeyFromLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getLast30DaysRange() {
  const toDate = new Date()
  const fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() - 29)
  return {
    from: createDateKeyFromLocalDate(fromDate),
    to: createDateKeyFromLocalDate(toDate),
  }
}

function parseFilterInput(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ActivityLogViewMode
  onChange: (next: ActivityLogViewMode) => void
}) {
  return (
    <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
      {(['session', 'event'] as const).map((mode) => (
        <Button
          key={mode}
          size="sm"
          variant={value === mode ? 'primary' : 'ghost'}
          className="rounded-xl"
          onClick={() => onChange(mode)}
        >
          {mode}
        </Button>
      ))}
    </div>
  )
}

function LoadingCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-5 text-sm text-slate-500">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-violet-500" />
        {label}
      </CardContent>
    </Card>
  )
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-rose-200 bg-rose-50">
      <CardContent className="space-y-2 p-5">
        <div className="text-sm font-semibold text-rose-900">{title}</div>
        <div className="text-sm text-rose-700">{message}</div>
      </CardContent>
    </Card>
  )
}

function ManualNotePlaceholder() {
  return (
    <Card className="border-dashed border-slate-200 bg-slate-50/70">
      <CardContent className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">手動メモ</div>
        <div className="text-sm text-slate-600">
          手動メモの追加と保存は後続フェーズで実装します。Phase 9 では表示枠だけ残しています。
        </div>
      </CardContent>
    </Card>
  )
}

function DailySummaryCard({ day }: { day: ActivityDayViewData }) {
  if (!day.dailyLog) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            DailyActivityLog
          </div>
          <div className="text-lg font-bold text-slate-900">その日のまとめ</div>
          <div className="text-sm text-slate-500">この日のまとめはまだ生成されていません。</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              DailyActivityLog
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">その日のまとめ</div>
          </div>
          <Badge tone="soft">{day.dailyLog.dateKey}</Badge>
        </div>
        <p className="text-sm leading-6 text-slate-600">{day.dailyLog.summary}</p>
        {day.dailyLog.mainThemes.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {day.dailyLog.mainThemes.map((theme) => (
              <Badge key={theme} tone="browsing">
                {theme}
              </Badge>
            ))}
          </div>
        ) : null}
        {day.dailyLog.reviewQuestions.length > 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              振り返りの問い
            </div>
            <div className="mt-2 space-y-2 text-sm text-slate-600">
              {day.dailyLog.reviewQuestions.map((question) => (
                <div key={question}>{question}</div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function OpenLoopsCard({
  title,
  openLoops,
}: {
  title?: string
  openLoops: ActivityDayViewData['openLoops'] | ActivityWeekViewData['openLoops']
}) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">OpenLoop</div>
          <div className="mt-1 text-lg font-bold text-slate-900">
            {title ?? '途中になっていること'}
          </div>
        </div>
        {openLoops.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            該当する OpenLoop はありません。
          </div>
        ) : (
          <div className="space-y-3">
            {openLoops.map((openLoop) => (
              <div key={openLoop.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">{openLoop.title}</div>
                  <Badge tone="outline">{openLoop.status}</Badge>
                </div>
                {openLoop.description ? (
                  <div className="mt-2 text-sm text-slate-600">{openLoop.description}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SessionsOrEventsCard({
  day,
  viewMode,
  includeHidden,
  onIncludeHiddenChange,
  onToggleSessionHidden,
}: {
  day: ActivityDayViewData
  viewMode: ActivityLogViewMode
  includeHidden: boolean
  onIncludeHiddenChange: (next: boolean) => void
  onToggleSessionHidden?: (sessionId: string, dateKey: string, hidden: boolean) => void
}) {
  const visibleSessions = day.sessions.filter((session) => includeHidden || !session.hidden)

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Timeline
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">
              {viewMode === 'event' ? 'イベント表示' : 'セッション表示'}
            </div>
          </div>
          <Badge tone="outline">表示モード: {viewMode}</Badge>
        </div>

        {viewMode === 'event' ? (
          day.rawEvents.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              表示できるイベントはありません。
            </div>
          ) : (
            <div className="space-y-3">
              {day.rawEvents.map((event) => (
                <div key={event.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {event.appName ?? 'App'} / {event.windowTitle ?? '(untitled)'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDateTime(event.occurredAt, 'HH:mm')}
                      </div>
                    </div>
                    <Clock3 className="mt-0.5 h-4 w-4 text-slate-400" />
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {event.domain ? `domain: ${event.domain}` : 'domain: (none)'}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : visibleSessions.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            表示できるセッションはありません。
          </div>
        ) : (
          <div className="space-y-3">
            {visibleSessions.map((session) => (
              <div key={session.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{session.title}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTime(session.startedAt, 'HH:mm')} -{' '}
                      {formatDateTime(session.endedAt, 'HH:mm')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock3 className="mt-0.5 h-4 w-4 text-slate-400" />
                    {onToggleSessionHidden ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={
                          session.hidden
                            ? `Restore session ${session.id}`
                            : `Hide session ${session.id}`
                        }
                        onClick={() =>
                          onToggleSessionHidden(session.id, session.dateKey, !session.hidden)
                        }
                      >
                        非表示
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  {[session.primaryCategory, session.appNames.join(', ')].filter(Boolean).join(' / ')}
                </div>
                {session.summary ? (
                  <div className="mt-2 text-sm text-slate-600">{session.summary}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TodayOrDayView({
  variant,
  dateKey,
}: {
  variant: 'today' | 'day'
  dateKey: string
}) {
  const aiConfig = useAppStore((state) => state.aiConfig)
  const settings = useAppStore((state) => state.settings)
  const [searchParams, setSearchParams] = useSearchParams()
  const viewMode = normalizeViewMode(searchParams.get('view'))
  const [day, setDay] = useState<ActivityDayViewData | null>(null)
  const [includeHiddenSessions, setIncludeHiddenSessions] = useState(false)
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(undefined)

    const load =
      variant === 'today'
        ? fetchActivityDayView(dateKey)
        : ensurePreviousDayDailyActivityLog({ aiConfig, settings, dateKey })

    void load
      .then((nextDay) => {
        if (active) {
          setDay(nextDay)
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '行動ログの読み込みに失敗しました。')
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [aiConfig, dateKey, settings, variant])

  const handleToggleSessionHidden = async (
    sessionId: string,
    sessionDateKey: string,
    hidden: boolean,
  ) => {
    await setActivitySessionHidden({
      sessionId,
      dateKey: sessionDateKey,
      hidden,
    })
    setDay((current) =>
      current
        ? {
            ...current,
            sessions: current.sessions.map((session) =>
              session.id === sessionId ? { ...session, hidden } : session,
            ),
          }
        : current,
    )
  }

  return (
    <Screen
      title={variant === 'today' ? '今日の行動ログ' : '日別行動ログ'}
      subtitle={
        variant === 'today'
          ? '本日の流れを session / event で確認します。'
          : '指定した日の行動ログを確認します。'
      }
    >
      <div className="space-y-4 pb-6">
        <RecordsSectionTabs active="activity" />
        <ActivityLogNav />
        <h2 className="text-xl font-bold text-slate-900">
          {variant === 'today' ? '今日の行動ログ' : '日別行動ログ'}
        </h2>
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Target
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">対象日: {dateKey}</div>
          </div>
          <ViewModeToggle
            value={viewMode}
            onChange={(next) => setSearchParams(next === 'session' ? {} : { view: next })}
          />
        </div>
        {isLoading ? <LoadingCard label="行動ログを読み込んでいます..." /> : null}
        {error ? (
          <ErrorCard title="行動ログを表示できませんでした" message={error} />
        ) : null}
        {!isLoading && !error && day ? (
          <>
            <DailySummaryCard day={day} />
            <ManualNotePlaceholder />
            {viewMode === 'session' ? (
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-sm font-semibold text-slate-700">hidden session を含める</span>
                <Switch
                  checked={includeHiddenSessions}
                  onCheckedChange={setIncludeHiddenSessions}
                  aria-label="Include hidden sessions in timeline"
                />
              </label>
            ) : null}
            <SessionsOrEventsCard
              day={day}
              viewMode={viewMode}
              includeHidden={includeHiddenSessions}
              onIncludeHiddenChange={setIncludeHiddenSessions}
              onToggleSessionHidden={handleToggleSessionHidden}
            />
            <OpenLoopsCard openLoops={day.openLoops} />
          </>
        ) : null}
      </div>
    </Screen>
  )
}

function CalendarView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const monthKey = normalizeMonthKey(searchParams.get('month'))
  const [days, setDays] = useState<Awaited<ReturnType<typeof fetchActivityCalendarMonth>>>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(undefined)

    void fetchActivityCalendarMonth(monthKey)
      .then((nextDays) => {
        if (active) {
          setDays(nextDays)
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'カレンダーの読み込みに失敗しました。')
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [monthKey])

  return (
    <Screen title="行動ログカレンダー" subtitle="1か月表示で DailyActivityLog を確認します。">
      <div className="space-y-4 pb-6">
        <RecordsSectionTabs active="activity" />
        <ActivityLogNav />
        <h2 className="text-xl font-bold text-slate-900">行動ログカレンダー</h2>
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Target Month
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">対象月: {monthKey}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => setSearchParams({ month: shiftMonthKey(monthKey, -1) })}
            >
              <span aria-hidden="true">&lt;</span>
            </Button>
            <Input
              type="month"
              aria-label="Month picker"
              className="w-[11rem]"
              value={monthKey}
              onChange={(event) =>
                setSearchParams({
                  month: normalizeMonthKey(event.target.value || getCurrentMonthKeyJst()),
                })
              }
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              onClick={() => setSearchParams({ month: shiftMonthKey(monthKey, 1) })}
            >
              <span aria-hidden="true">&gt;</span>
            </Button>
          </div>
        </div>
        {isLoading ? <LoadingCard label="月の行動ログを読み込んでいます..." /> : null}
        {error ? <ErrorCard title="カレンダーを表示できませんでした" message={error} /> : null}
        {!isLoading && !error ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {days.map((day) => (
              <Card key={day.dateKey}>
                <button
                  type="button"
                  aria-label={`${day.dateKey} details`}
                  className="w-full text-left transition hover:bg-slate-50"
                  onClick={() => navigate(`/records/activity/day/${day.dateKey}`)}
                >
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-base font-bold text-slate-900">{day.dateKey}</div>
                      <CalendarDays className="h-4 w-4 text-violet-500" />
                    </div>
                    <div className="text-sm text-slate-600">
                      {day.dailyLog?.summary ?? 'この日のまとめはまだ生成されていません。'}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(day.dailyLog?.mainThemes ?? []).map((theme) => (
                        <Badge key={`${day.dateKey}_${theme}`} tone="soft">
                          {theme}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </button>
              </Card>
            ))}
          </div>
        ) : null}
      </div>
    </Screen>
  )
}

function ReviewYearView() {
  const aiConfig = useAppStore((state) => state.aiConfig)
  const settings = useAppStore((state) => state.settings)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const year = normalizeYear(searchParams.get('year'))
  const [reviews, setReviews] = useState<Awaited<ReturnType<typeof fetchActivityReviewYear>>>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(undefined)

    void ensurePreviousWeekReviewForWeb({
      aiConfig,
      settings,
      routeScope: 'year',
      year,
    })
      .then(() => fetchActivityReviewYear(year))
      .then((nextReviews) => {
        if (active) {
          setReviews(nextReviews)
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '年一覧の読み込みに失敗しました。')
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [aiConfig, settings, year])

  return (
    <Screen title="週次行動レビュー" subtitle="1年分の週次レビューを一覧で確認します。">
      <div className="space-y-4 pb-6">
        <RecordsSectionTabs active="activity" />
        <ActivityLogNav year={year} />
        <h2 className="text-xl font-bold text-slate-900">週次行動レビュー一覧</h2>
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Target Year
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">対象年: {year}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous year"
              onClick={() => setSearchParams({ year: String(year - 1) })}
            >
              <span aria-hidden="true">&lt;</span>
            </Button>
            <Input
              type="number"
              aria-label="Year picker"
              className="w-[8rem]"
              value={String(year)}
              onChange={(event) => setSearchParams({ year: String(normalizeYear(event.target.value)) })}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Next year"
              onClick={() => setSearchParams({ year: String(year + 1) })}
            >
              <span aria-hidden="true">&gt;</span>
            </Button>
          </div>
        </div>
        {isLoading ? <LoadingCard label="週次レビュー一覧を読み込んでいます..." /> : null}
        {error ? <ErrorCard title="年一覧を表示できませんでした" message={error} /> : null}
        {!isLoading && !error ? (
          <div className="space-y-3">
            {reviews.length === 0 ? (
              <Card>
                <CardContent className="p-5 text-sm text-slate-500">
                  この年の週次レビューはまだありません。
                </CardContent>
              </Card>
            ) : (
              reviews.map((review) => (
                <Card key={review.weekKey}>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{review.weekKey}</div>
                        <div className="mt-1 text-sm text-slate-600">{review.summary}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Open ${review.weekKey}`}
                        onClick={() => navigate(`/records/activity/review/week?weekKey=${review.weekKey}`)}
                      >
                        詳細を見る
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {review.focusThemes.map((theme) => (
                        <Badge key={`${review.weekKey}_${theme}`} tone="warning">
                          {theme}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Screen>
  )
}

function ReviewWeekView({ weekKey }: { weekKey: string }) {
  const aiConfig = useAppStore((state) => state.aiConfig)
  const settings = useAppStore((state) => state.settings)
  const [week, setWeek] = useState<ActivityWeekViewData | null>(null)
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(undefined)

    void ensurePreviousWeekReviewForWeb({
      aiConfig,
      settings,
      routeScope: 'week',
      weekKey,
    })
      .then(() => fetchActivityReviewWeek(weekKey))
      .then((nextWeek) => {
        if (active) {
          setWeek(nextWeek)
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '週次レビューの読み込みに失敗しました。')
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [aiConfig, settings, weekKey])

  return (
    <Screen title="週次行動レビュー詳細" subtitle="指定した週のふりかえりを確認します。">
      <div className="space-y-4 pb-6">
        <RecordsSectionTabs active="activity" />
        <ActivityLogNav year={Number(weekKey.slice(0, 4)) || getCurrentYearJst()} />
        <h2 className="text-xl font-bold text-slate-900">週次行動レビュー詳細</h2>
        <Card>
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                WeeklyActivityReview
              </div>
              <div className="mt-1 text-lg font-bold text-slate-900">週キー: {weekKey}</div>
            </div>
            <Sparkles className="h-5 w-5 text-violet-500" />
          </CardContent>
        </Card>
        {isLoading ? <LoadingCard label="週次レビューを読み込んでいます..." /> : null}
        {error ? <ErrorCard title="週次レビューを表示できませんでした" message={error} /> : null}
        {!isLoading && !error ? (
          <>
            <Card>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-slate-600">
                  {week?.review?.summary ?? 'この週のレビューはまだ生成されていません。'}
                </p>
                {week?.review?.focusThemes?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {week.review.focusThemes.map((theme) => (
                      <Badge key={theme} tone="warning">
                        {theme}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {week?.review ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {Object.entries(week.review.categoryDurations).map(([label, minutes]) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-xs text-slate-500">{label}</div>
                        <div className="mt-1 text-lg font-bold text-slate-900">{minutes}分</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
            <OpenLoopsCard title="その週の OpenLoop" openLoops={week?.openLoops ?? []} />
          </>
        ) : null}
      </div>
    </Screen>
  )
}

function SearchView() {
  const defaultRange = useMemo(() => getLast30DaysRange(), [])
  const [from, setFrom] = useState(defaultRange.from)
  const [to, setTo] = useState(defaultRange.to)
  const [keyword, setKeyword] = useState('')
  const [categories, setCategories] = useState('')
  const [apps, setApps] = useState('')
  const [domains, setDomains] = useState('')
  const [includeOpenLoops, setIncludeOpenLoops] = useState(true)
  const [includeHidden, setIncludeHidden] = useState(false)
  const [results, setResults] = useState<ActivitySearchResult>({ sessions: [], openLoops: [] })
  const [error, setError] = useState<string>()
  const [actionMessage, setActionMessage] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(undefined)

    void searchActivityLogs({
      from,
      to,
      keyword,
      categories: parseFilterInput(categories),
      apps: parseFilterInput(apps),
      domains: parseFilterInput(domains),
      includeOpenLoops,
      includeHidden,
    })
      .then((nextResults) => {
        if (active) {
          setResults(nextResults)
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '検索ログの読み込みに失敗しました。')
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [apps, categories, domains, from, includeHidden, includeOpenLoops, keyword, reloadToken, to])

  const deleteEnabled = canDeleteActionLogRange({ from, to })

  const handleToggleSessionHidden = async (sessionId: string, dateKey: string, hidden: boolean) => {
    const updated = await setActivitySessionHidden({
      sessionId,
      dateKey,
      hidden,
    })
    setResults((current) => ({
      ...current,
      sessions: current.sessions
        .map((session) =>
          session.id === sessionId ? { ...session, hidden: updated.hidden } : session,
        )
        .filter((session) => includeHidden || !session.hidden),
    }))
  }

  const handleExport = async () => {
    const bundle = await exportActionLogBundle({ from, to })
    if (typeof window.URL?.createObjectURL !== 'function') {
      setActionMessage('この環境では JSON Export を開始できません。')
      return
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const objectUrl = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `action-log-${from}-${to}.json`
    anchor.click()
    window.URL.revokeObjectURL(objectUrl)
    setActionMessage('行動ログを書き出しました。')
  }

  const handleDelete = async () => {
    await deleteActionLogDateRange({ from, to })
    setActionMessage('行動ログを削除しました。')
    setReloadToken((current) => current + 1)
  }

  return (
    <Screen title="行動ログ検索" subtitle="Session と OpenLoop をキーワードと期間で絞り込みます。">
      <div className="space-y-4 pb-6">
        <RecordsSectionTabs active="activity" />
        <ActivityLogNav />
        <h2 className="text-xl font-bold text-slate-900">行動ログ検索</h2>
        <Card>
          <CardContent className="space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</div>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">キーワードで検索</span>
              <div className="flex gap-2">
                <Input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="キーワードで検索"
                  aria-label="Search keyword"
                />
                <Button variant="outline" size="icon" aria-label="Search action">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">開始日</span>
                <Input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  aria-label="From date"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">終了日</span>
                <Input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  aria-label="To date"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Categories</span>
                <Input
                  value={categories}
                  onChange={(event) => setCategories(event.target.value)}
                  aria-label="Category filters"
                  placeholder="study, work"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Apps</span>
                <Input
                  value={apps}
                  onChange={(event) => setApps(event.target.value)}
                  aria-label="App filters"
                  placeholder="Chrome, Code"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Domains</span>
                <Input
                  value={domains}
                  onChange={(event) => setDomains(event.target.value)}
                  aria-label="Domain filters"
                  placeholder="developer.chrome.com"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-sm font-semibold text-slate-700">OpenLoop を含める</span>
                <Switch
                  checked={includeOpenLoops}
                  onCheckedChange={setIncludeOpenLoops}
                  aria-label="Include open loops"
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-sm font-semibold text-slate-700">hidden session を含める</span>
                <Switch
                  checked={includeHidden}
                  onCheckedChange={setIncludeHidden}
                  aria-label="Include hidden sessions"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void handleExport()} aria-label="Export action-log JSON">
                JSON Export
              </Button>
              <Button
                variant="danger"
                onClick={() => void handleDelete()}
                aria-label="Delete selected action-log range"
                disabled={!deleteEnabled}
              >
                期間削除
              </Button>
            </div>
            {actionMessage ? <div className="text-sm text-slate-600">{actionMessage}</div> : null}
          </CardContent>
        </Card>
        {isLoading ? <LoadingCard label="検索対象のログを読み込んでいます..." /> : null}
        {error ? <ErrorCard title="検索ログを表示できませんでした" message={error} /> : null}
        {!isLoading && !error ? (
          <>
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">ActivitySession</div>
                  <Badge tone="soft">{results.sessions.length}件</Badge>
                </div>
                {results.sessions.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    条件に合う session はありません。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {results.sessions.map((session) => (
                      <div key={session.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{session.title}</div>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={
                              session.hidden
                                ? `Restore session ${session.id}`
                                : `Hide session ${session.id}`
                            }
                            onClick={() =>
                              void handleToggleSessionHidden(session.id, session.dateKey, !session.hidden)
                            }
                          >
                            {session.hidden ? '再表示' : '非表示'}
                          </Button>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(session.startedAt, 'M/d HH:mm')} -{' '}
                          {formatDateTime(session.endedAt, 'HH:mm')}
                        </div>
                        {session.summary ? (
                          <div className="mt-2 text-sm text-slate-600">{session.summary}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">OpenLoop</div>
                  <Badge tone="soft">{results.openLoops.length}件</Badge>
                </div>
                {results.openLoops.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    条件に合う OpenLoop はありません。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {results.openLoops.map((openLoop) => (
                      <div key={openLoop.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-sm font-semibold text-slate-900">{openLoop.title}</div>
                        {openLoop.description ? (
                          <div className="mt-2 text-sm text-slate-600">{openLoop.description}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </Screen>
  )
}

export function ActivityLogScreen({ variant }: { variant: ActivityLogVariant }) {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const location = useLocation()

  useEffect(() => {
    writeLastRecordsRoute(location.pathname, location.search)
  }, [location.pathname, location.search])

  if (variant === 'today') {
    return <TodayOrDayView variant="today" dateKey={getTodayDateKeyJst()} />
  }

  if (variant === 'day') {
    return <TodayOrDayView variant="day" dateKey={params.dateKey ?? getTodayDateKeyJst()} />
  }

  if (variant === 'calendar') {
    return <CalendarView />
  }

  if (variant === 'search') {
    return <SearchView />
  }

  if (variant === 'review-year') {
    return <ReviewYearView />
  }

  return (
    <ReviewWeekView
      weekKey={normalizeWeekKey(searchParams.get('weekKey') ?? getCurrentWeekKeyJst())}
    />
  )
}
