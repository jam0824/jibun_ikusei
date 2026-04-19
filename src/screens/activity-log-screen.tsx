import { CalendarDays, Clock3, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ActivityLogNav, RecordsSectionTabs } from '@/components/records-navigation'
import type { ActivitySession, RawEvent } from '@/domain/action-log-types'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Input, Switch } from '@/components/ui'
import { formatDateTime } from '@/lib/date'
import { BrowsingTimeView } from '@/screens/browsing-time-view'
import {
  buildCompactSessionBlocks,
  type CompactSessionBlock,
  type ActivityDayViewData,
  type ActivityDayShellData,
  type ActivityLogViewMode,
  type ActivitySearchResult,
  type ActivityWeekViewData,
  canDeleteActionLogRange,
  deleteActionLogDateRange,
  ensurePreviousWeekReviewForWeb,
  exportActionLogBundle,
  fetchActivityCalendarMonth,
  fetchActivityDayEventPage,
  fetchActivityDaySessionPage,
  fetchActivityDayShell,
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
  resolveDefaultReviewYearJst,
  searchActivityLogs,
  setActivitySessionHidden,
  shiftMonthKey,
} from '@/lib/action-log-view'
import { useAppStore } from '@/store/app-store'

type ActivityLogVariant = 'today' | 'day' | 'calendar' | 'search' | 'browsing' | 'review-year' | 'review-week'

type TimelinePageState<T> = {
  items: T[]
  nextCursor: string | null
  hasLoaded: boolean
  isLoading: boolean
  isLoadingMore: boolean
}

function createEmptyTimelinePageState<T>(): TimelinePageState<T> {
  return {
    items: [],
    nextCursor: null,
    hasLoaded: false,
    isLoading: false,
    isLoadingMore: false,
  }
}

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
    <div className="inline-flex shrink-0 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
      {(['session', 'event'] as const).map((mode) => (
        <Button
          key={mode}
          size="sm"
          variant={value === mode ? 'primary' : 'ghost'}
          className="min-w-[5.5rem] rounded-xl px-4 text-base sm:min-w-0 sm:px-3 sm:text-xs"
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

const DAILY_SECTION_MISSING_MESSAGE = 'まだ生成されていません。次回また生成します。'

function getDailySectionContent(value: string | undefined) {
  if (value?.trim()) {
    return value
  }
  return DAILY_SECTION_MISSING_MESSAGE
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
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              DailyActivityLog
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">その日のまとめ</div>
          </div>
          <Badge tone="soft">{day.dateKey}</Badge>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-900">その日のまとめ</div>
            <p className="text-sm leading-6 text-slate-600">
              {getDailySectionContent(day.dailyLog.summary)}
            </p>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-900">クエストクリア状況まとめ</div>
            <p className="text-sm leading-6 text-slate-600">
              {getDailySectionContent(day.dailyLog.questSummary)}
            </p>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-900">健康状況まとめ</div>
            <p className="text-sm leading-6 text-slate-600">
              {getDailySectionContent(day.dailyLog.healthSummary)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SituationLogCard({
  situationLogs,
}: {
  situationLogs: ActivityDayViewData['situationLogs']
}) {
  if (situationLogs.length === 0) {
    return null
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            SituationLog
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900">30分まとめ</div>
        </div>
        <div className="space-y-3">
          {situationLogs.map((situationLog) => (
            <div
              key={situationLog.timestamp}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <div className="text-xs text-slate-500">{formatDateTime(situationLog.timestamp, 'HH:mm')}</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">{situationLog.summary}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function buildSessionPrimaryText(session: ActivitySession) {
  return session.summary?.trim() || session.title
}

function buildSessionSecondaryText(session: ActivitySession) {
  if (session.summary?.trim()) {
    return session.title
  }

  return [session.primaryCategory, session.appNames.join(', '), session.domains.join(', ')]
    .filter(Boolean)
    .join(' / ')
}

function buildSessionMetaText(session: ActivitySession) {
  if (!session.summary?.trim()) {
    return ''
  }

  return [session.primaryCategory, session.appNames.join(', ')].filter(Boolean).join(' / ')
}

function SessionListItem({
  session,
  onToggleSessionHidden,
  timeStartFormat,
  timeEndFormat,
  className,
  showClockIcon = false,
}: {
  session: ActivitySession
  onToggleSessionHidden?: (sessionId: string, dateKey: string, hidden: boolean) => void
  timeStartFormat: string
  timeEndFormat: string
  className: string
  showClockIcon?: boolean
}) {
  const primaryText = buildSessionPrimaryText(session)
  const secondaryText = buildSessionSecondaryText(session)
  const metaText = buildSessionMetaText(session)

  return (
    <div data-testid={`activity-session-${session.id}`} className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-7 text-slate-900">{primaryText}</div>
          <div className="mt-2 text-xs text-slate-500">
            {formatDateTime(session.startedAt, timeStartFormat)} -{' '}
            {formatDateTime(session.endedAt, timeEndFormat)}
          </div>
          {secondaryText ? <div className="mt-2 text-sm text-slate-600">{secondaryText}</div> : null}
          {metaText ? <div className="mt-1 text-xs text-slate-500">{metaText}</div> : null}
        </div>
        {onToggleSessionHidden ? (
          <div className="flex shrink-0 items-center gap-2">
            {showClockIcon ? <Clock3 className="mt-0.5 h-4 w-4 text-slate-400" /> : null}
            <Button
              variant="ghost"
              size="sm"
              aria-label={
                session.hidden ? `Restore session ${session.id}` : `Hide session ${session.id}`
              }
              onClick={() => onToggleSessionHidden(session.id, session.dateKey, !session.hidden)}
            >
              {session.hidden ? '再表示' : '非表示'}
            </Button>
          </div>
        ) : showClockIcon ? (
          <div className="shrink-0 pt-0.5">
            <Clock3 className="h-4 w-4 text-slate-400" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CompactSessionListItem({
  block,
  timeStartFormat,
  timeEndFormat,
  className,
}: {
  block: CompactSessionBlock
  timeStartFormat: string
  timeEndFormat: string
  className: string
}) {
  return (
    <div data-testid={`activity-session-compact-${block.id}`} className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-7 text-slate-900">{block.primaryText}</div>
          <div className="mt-2 text-xs text-slate-500">
            {formatDateTime(block.startedAt, timeStartFormat)} - {formatDateTime(block.endedAt, timeEndFormat)}
          </div>
          {block.secondaryText ? <div className="mt-2 text-sm text-slate-600">{block.secondaryText}</div> : null}
          {block.metaText ? <div className="mt-1 text-xs text-slate-500">{block.metaText}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="soft">{block.sessionCount}件</Badge>
          <Clock3 className="mt-0.5 h-4 w-4 text-slate-400" />
        </div>
      </div>
    </div>
  )
}

function TimelineLoadMore({
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  hasMore: boolean
  isLoadingMore?: boolean
  onLoadMore: () => void
}) {
  if (!hasMore) {
    return null
  }

  return (
    <div className="border-t border-slate-100 pt-2">
      <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
        {isLoadingMore ? '読み込み中...' : 'さらに50件表示'}
      </Button>
    </div>
  )
}

function SessionsOrEventsCard({
  sessions,
  rawEvents,
  viewMode,
  hasMoreSessions,
  hasMoreEvents,
  isLoadingMoreSessions,
  isLoadingMoreEvents,
  onLoadMoreSessions,
  onLoadMoreEvents,
}: {
  sessions: ActivitySession[]
  rawEvents: RawEvent[]
  viewMode: ActivityLogViewMode
  hasMoreSessions: boolean
  hasMoreEvents: boolean
  isLoadingMoreSessions?: boolean
  isLoadingMoreEvents?: boolean
  onLoadMoreSessions: () => void
  onLoadMoreEvents: () => void
}) {
  const compactSessionBlocks = useMemo(() => buildCompactSessionBlocks(sessions), [sessions])

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
          rawEvents.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              表示できるイベントはありません。
            </div>
          ) : (
            <div className="space-y-3">
              {rawEvents.map((event) => (
                <div
                  key={event.id}
                  data-testid={`activity-event-${event.id}`}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
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
              <TimelineLoadMore
                hasMore={hasMoreEvents}
                isLoadingMore={isLoadingMoreEvents}
                onLoadMore={onLoadMoreEvents}
              />
            </div>
          )
        ) : compactSessionBlocks.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              表示できるセッションはありません。
            </div>
          ) : (
          <div className="space-y-3">
            {compactSessionBlocks.map((block) => (
              block.kind === 'single' ? (
                <SessionListItem
                  key={block.id}
                  session={block.representativeSession}
                  timeStartFormat="HH:mm"
                  timeEndFormat="HH:mm"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                  showClockIcon
                />
              ) : (
                <CompactSessionListItem
                  key={block.id}
                  block={block}
                  timeStartFormat="HH:mm"
                  timeEndFormat="HH:mm"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                />
              )
            ))}
            <TimelineLoadMore
              hasMore={hasMoreSessions}
              isLoadingMore={isLoadingMoreSessions}
              onLoadMore={onLoadMoreSessions}
            />
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
  const [searchParams, setSearchParams] = useSearchParams()
  const viewMode = normalizeViewMode(searchParams.get('view'))
  const [dayShell, setDayShell] = useState<ActivityDayShellData | null>(null)
  const [includeHiddenSessions, setIncludeHiddenSessions] = useState(false)
  const [sessionTimeline, setSessionTimeline] = useState<TimelinePageState<ActivitySession>>(() =>
    createEmptyTimelinePageState<ActivitySession>(),
  )
  const [eventTimeline, setEventTimeline] = useState<TimelinePageState<RawEvent>>(() =>
    createEmptyTimelinePageState<RawEvent>(),
  )
  const [error, setError] = useState<string>()
  const [isShellLoading, setIsShellLoading] = useState(true)

  useEffect(() => {
    let active = true
    setIsShellLoading(true)
    setError(undefined)
    setDayShell(null)
    setSessionTimeline(createEmptyTimelinePageState<ActivitySession>())
    setEventTimeline(createEmptyTimelinePageState<RawEvent>())

    void fetchActivityDayShell(dateKey)
      .then((nextDayShell) => {
        if (active) {
          setDayShell(nextDayShell)
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '行動ログの読み込みに失敗しました。')
        }
      })
      .finally(() => {
        if (active) {
          setIsShellLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [dateKey, variant])

  useEffect(() => {
    setSessionTimeline(createEmptyTimelinePageState<ActivitySession>())
  }, [includeHiddenSessions])

  useEffect(() => {
    if (viewMode !== 'session' || sessionTimeline.hasLoaded || sessionTimeline.isLoading) {
      return
    }

    let active = true
    setSessionTimeline((current) => ({
      ...current,
      isLoading: true,
    }))

    void fetchActivityDaySessionPage({
      dateKey,
      includeHidden: includeHiddenSessions,
    })
      .then((page) => {
        if (active) {
          setSessionTimeline({
            items: page.items,
            nextCursor: page.nextCursor,
            hasLoaded: true,
            isLoading: false,
            isLoadingMore: false,
          })
        }
      })
      .catch((cause) => {
        if (active) {
          setSessionTimeline((current) => ({
            ...current,
            isLoading: false,
            isLoadingMore: false,
          }))
          setError(cause instanceof Error ? cause.message : '行動ログの読み込みに失敗しました。')
        }
      })

    return () => {
      active = false
    }
  }, [dateKey, includeHiddenSessions, sessionTimeline.hasLoaded, viewMode])

  useEffect(() => {
    if (viewMode !== 'event' || eventTimeline.hasLoaded || eventTimeline.isLoading) {
      return
    }

    let active = true
    setEventTimeline((current) => ({
      ...current,
      isLoading: true,
    }))

    void fetchActivityDayEventPage({ dateKey })
      .then((page) => {
        if (active) {
          setEventTimeline({
            items: page.items,
            nextCursor: page.nextCursor,
            hasLoaded: true,
            isLoading: false,
            isLoadingMore: false,
          })
        }
      })
      .catch((cause) => {
        if (active) {
          setEventTimeline((current) => ({
            ...current,
            isLoading: false,
            isLoadingMore: false,
          }))
          setError(cause instanceof Error ? cause.message : '行動ログの読み込みに失敗しました。')
        }
      })

    return () => {
      active = false
    }
  }, [dateKey, eventTimeline.hasLoaded, viewMode])

  const day: ActivityDayViewData | null = dayShell
    ? {
        dateKey: dayShell.dateKey,
        sessions: sessionTimeline.items,
        rawEvents: eventTimeline.items,
        dailyLog: dayShell.dailyLog,
        situationLogs: dayShell.situationLogs,
      }
    : null

  const isLoading =
    isShellLoading ||
    (viewMode === 'session'
      ? sessionTimeline.isLoading && !sessionTimeline.hasLoaded
      : eventTimeline.isLoading && !eventTimeline.hasLoaded)

  function loadMoreSessions() {
    if (!sessionTimeline.nextCursor || sessionTimeline.isLoadingMore) {
      return
    }

    setSessionTimeline((current) => ({
      ...current,
      isLoadingMore: true,
    }))

    void fetchActivityDaySessionPage({
      dateKey,
      cursor: sessionTimeline.nextCursor,
      includeHidden: includeHiddenSessions,
    })
      .then((page) => {
        setSessionTimeline((current) => ({
          ...current,
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
          isLoadingMore: false,
          hasLoaded: true,
        }))
      })
      .catch((cause) => {
        setSessionTimeline((current) => ({
          ...current,
          isLoadingMore: false,
        }))
        setError(cause instanceof Error ? cause.message : '行動ログの読み込みに失敗しました。')
      })
  }

  function loadMoreEvents() {
    if (!eventTimeline.nextCursor || eventTimeline.isLoadingMore) {
      return
    }

    setEventTimeline((current) => ({
      ...current,
      isLoadingMore: true,
    }))

    void fetchActivityDayEventPage({
      dateKey,
      cursor: eventTimeline.nextCursor,
    })
      .then((page) => {
        setEventTimeline((current) => ({
          ...current,
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
          isLoadingMore: false,
          hasLoaded: true,
        }))
      })
      .catch((cause) => {
        setEventTimeline((current) => ({
          ...current,
          isLoadingMore: false,
        }))
        setError(cause instanceof Error ? cause.message : '行動ログの読み込みに失敗しました。')
      })
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
        <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target</div>
          <div
            data-testid="activity-day-target-row"
            className="flex items-center justify-between gap-3"
          >
            <div className="min-w-0 text-base font-bold text-slate-900 sm:text-lg">
              対象日: {dateKey}
            </div>
            <ViewModeToggle
              value={viewMode}
              onChange={(next) => setSearchParams(next === 'session' ? {} : { view: next })}
            />
          </div>
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
              <>
                <SituationLogCard situationLogs={day.situationLogs} />
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-700">hidden session を含める</span>
                  <Switch
                    checked={includeHiddenSessions}
                    onCheckedChange={setIncludeHiddenSessions}
                    aria-label="Include hidden sessions in timeline"
                  />
                </label>
              </>
            ) : null}
            <SessionsOrEventsCard
              sessions={sessionTimeline.items}
              rawEvents={eventTimeline.items}
              viewMode={viewMode}
              hasMoreSessions={sessionTimeline.nextCursor !== null}
              hasMoreEvents={eventTimeline.nextCursor !== null}
              isLoadingMoreSessions={sessionTimeline.isLoadingMore}
              isLoadingMoreEvents={eventTimeline.isLoadingMore}
              onLoadMoreSessions={loadMoreSessions}
              onLoadMoreEvents={loadMoreEvents}
            />
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
  const rawYear = searchParams.get('year')
  const year = rawYear ? normalizeYear(rawYear) : null
  const displayYear = year ?? getCurrentYearJst()
  const [reviews, setReviews] = useState<Awaited<ReturnType<typeof fetchActivityReviewYear>>>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(undefined)

    void Promise.resolve()
      .then(async () => {
        const targetYear = year ?? (await resolveDefaultReviewYearJst())

        if (!active) {
          return null
        }

        if (year === null) {
          setSearchParams({ year: String(targetYear) }, { replace: true })
          return null
        }

        await ensurePreviousWeekReviewForWeb({
          aiConfig,
          settings,
          routeScope: 'year',
          year: targetYear,
        })

        return fetchActivityReviewYear(targetYear)
      })
      .then((nextReviews) => {
        if (active && nextReviews) {
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
  }, [aiConfig, setSearchParams, settings, year])

  return (
    <Screen title="週次行動レビュー" subtitle="1年分の週次レビューを一覧で確認します。">
      <div className="space-y-4 pb-6">
        <RecordsSectionTabs active="activity" />
        <ActivityLogNav year={year ?? undefined} />
        <h2 className="text-xl font-bold text-slate-900">週次行動レビュー一覧</h2>
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Target Year
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">対象年: {displayYear}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous year"
              onClick={() => setSearchParams({ year: String(displayYear - 1) })}
            >
              <span aria-hidden="true">&lt;</span>
            </Button>
            <Input
              type="number"
              aria-label="Year picker"
              className="w-[8rem]"
              value={String(displayYear)}
              onChange={(event) => setSearchParams({ year: String(normalizeYear(event.target.value)) })}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Next year"
              onClick={() => setSearchParams({ year: String(displayYear + 1) })}
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">{review.weekKey}</div>
                        <div className="mt-1 text-sm text-slate-600">{review.summary}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="self-start"
                        aria-label={`Open ${review.weekKey}`}
                        onClick={() => navigate(`/records/activity/review/week?weekKey=${review.weekKey}`)}
                      >
                        詳細
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

function UsageSummaryCard({
  title,
  items,
  emptyLabel,
}: {
  title: string
  items: ActivityWeekViewData['topApps'] | ActivityWeekViewData['topDomains']
  emptyLabel: string
}) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        {items.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            {emptyLabel}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={`${title}_${item.label}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="text-sm font-medium text-slate-900">{item.label}</div>
                <Badge tone="outline">{item.minutes}分</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <UsageSummaryCard
                title="よく使ったアプリ"
                items={week?.topApps ?? []}
                emptyLabel="この週のアプリ利用はまだありません。"
              />
              <UsageSummaryCard
                title="よく見ていたドメイン"
                items={week?.topDomains ?? []}
                emptyLabel="この週のドメイン利用はまだありません。"
              />
            </div>
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
  const [includeHidden, setIncludeHidden] = useState(false)
  const [results, setResults] = useState<ActivitySearchResult>({ sessions: [] })
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
  }, [apps, categories, domains, from, includeHidden, keyword, reloadToken, to])

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
    <Screen title="行動ログ検索" subtitle="Session をキーワードと期間で絞り込みます。">
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
            <div className="grid gap-3 sm:grid-cols-1">
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
                      <SessionListItem
                        key={session.id}
                        session={session}
                        onToggleSessionHidden={(sessionId, dateKey, hidden) => {
                          void handleToggleSessionHidden(sessionId, dateKey, hidden)
                        }}
                        timeStartFormat="M/d HH:mm"
                        timeEndFormat="HH:mm"
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      />
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

function BrowsingView() {
  return (
    <Screen title="閲覧集計" subtitle="Web 閲覧時間を期間ごとに確認できます。">
      <div className="space-y-4 pb-6">
        <RecordsSectionTabs active="activity" />
        <ActivityLogNav />
        <h2 className="text-xl font-bold text-slate-900">閲覧集計</h2>
        <BrowsingTimeView />
      </div>
    </Screen>
  )
}

export function ActivityLogScreen({ variant }: { variant: ActivityLogVariant }) {
  const params = useParams()
  const [searchParams] = useSearchParams()

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

  if (variant === 'browsing') {
    return <BrowsingView />
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
