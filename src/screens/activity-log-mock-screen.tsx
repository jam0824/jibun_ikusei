import { CalendarDays, Clock3, Search, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Input } from '@/components/ui'
import { formatDateTime, getDayKey, getWeekKey } from '@/lib/date'
import {
  getActivityDayMock,
  getActivitySearchMockResults,
  getCalendarDayMocksByMonth,
  getWeeklyActivityReviewMock,
  getWeeklyActivityReviewYearMocks,
  type ActivityDayMock,
  type ActivityLogViewMode,
} from '@/screens/activity-log-mock-data'

type ActivityLogMockVariant = 'today' | 'day' | 'calendar' | 'search' | 'review-year' | 'review-week'

function normalizeViewMode(value: string | null): ActivityLogViewMode {
  return value === 'event' ? 'event' : 'session'
}

function normalizeMonthKey(value: string | null) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    return value
  }

  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function normalizeYear(value: string | null) {
  const parsed = Number(value)

  if (Number.isFinite(parsed) && parsed >= 2000 && parsed <= 2100) {
    return parsed
  }

  return new Date().getFullYear()
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

function MockNotice({ label }: { label: string }) {
  return (
    <Card className="border-dashed border-violet-200 bg-violet-50/70">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="default">Mock</Badge>
            <div className="text-sm font-semibold text-slate-900">{label}</div>
          </div>
          <div className="mt-2 text-sm text-slate-600">
            Phase 0 の仮画面です。route と表示枠だけを先に確認し、実データ接続は後続フェーズで差し替えます。
          </div>
        </div>
        <Badge tone="outline">PWA 直接着地を確認中</Badge>
      </CardContent>
    </Card>
  )
}

function DailyLogCard({ dailyLog }: { dailyLog: ActivityDayMock['dailyLog'] }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">DailyActivityLog</div>
            <div className="mt-1 text-lg font-bold text-slate-900">その日のまとめ</div>
          </div>
          <Badge tone="soft">{dailyLog.dateKey}</Badge>
        </div>
        <p className="text-sm leading-6 text-slate-600">{dailyLog.summary}</p>
        <div className="flex flex-wrap gap-2">
          {dailyLog.mainThemes.map((theme) => (
            <Badge key={theme} tone="browsing">
              {theme}
            </Badge>
          ))}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">手動メモ枠</div>
          <div className="mt-2 text-sm text-slate-600">{dailyLog.notePreview}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function SessionsOrEventsCard({
  day,
  viewMode,
}: {
  day: ActivityDayMock
  viewMode: ActivityLogViewMode
}) {
  const items =
    viewMode === 'event'
      ? day.rawEvents.map((event) => ({
          id: event.id,
          title: `${event.appName} / ${event.windowTitle}`,
          subline: formatDateTime(event.occurredAt, 'HH:mm'),
          detail: event.domain ? `domain: ${event.domain}` : 'domain: (なし)',
        }))
      : day.sessions.map((session) => ({
          id: session.id,
          title: session.title,
          subline: `${formatDateTime(session.startedAt, 'HH:mm')} - ${formatDateTime(session.endedAt, 'HH:mm')}`,
          detail: `${session.primaryCategory} / ${session.appNames.join(', ')}`,
        }))

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline</div>
            <div className="mt-1 text-lg font-bold text-slate-900">
              {viewMode === 'event' ? 'イベント表示' : 'セッション表示'}
            </div>
          </div>
          <Badge tone="outline">表示単位: {viewMode}</Badge>
        </div>
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.subline}</div>
                </div>
                <Clock3 className="mt-0.5 h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-2 text-sm text-slate-600">{item.detail}</div>
            </div>
          ))}
        </div>
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
  const day = useMemo(() => getActivityDayMock(dateKey), [dateKey])

  return (
    <Screen
      title={variant === 'today' ? '今日の行動ログ' : '日別の行動ログ'}
      subtitle="Phase 0 の mock 画面です。route と表示枠だけを先に確認します。"
    >
      <div className="space-y-4 pb-6">
        <MockNotice label={variant === 'today' ? 'today mock route' : 'day mock route'} />
        <h2 className="text-xl font-bold text-slate-900">
          {variant === 'today' ? '今日の行動ログ' : '日別の行動ログ'}
        </h2>
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target</div>
            <div className="mt-1 text-lg font-bold text-slate-900">対象日: {dateKey}</div>
          </div>
          <ViewModeToggle
            value={viewMode}
            onChange={(next) => setSearchParams(next === 'session' ? {} : { view: next })}
          />
        </div>
        <DailyLogCard dailyLog={day.dailyLog} />
        <SessionsOrEventsCard day={day} viewMode={viewMode} />
      </div>
    </Screen>
  )
}

function CalendarView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const monthKey = normalizeMonthKey(searchParams.get('month'))
  const days = useMemo(() => getCalendarDayMocksByMonth(monthKey), [monthKey])

  return (
    <Screen
      title="行動ログカレンダー"
      subtitle="日ごとの記録量と DailyActivityLog の表示枠だけを mock で確認します。"
    >
      <div className="space-y-4 pb-6">
        <MockNotice label="calendar mock route" />
        <h2 className="text-xl font-bold text-slate-900">行動ログカレンダー</h2>
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target Month</div>
            <div className="mt-1 text-lg font-bold text-slate-900">対象月: {monthKey}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="前月"
              onClick={() => {
                const [yearText, monthText] = monthKey.split('-')
                const baseDate = new Date(Number(yearText), Number(monthText) - 2, 1)
                setSearchParams({ month: `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}` })
              }}
            >
              <span aria-hidden="true">&lt;</span>
            </Button>
            <Input
              type="month"
              aria-label="対象月ピッカー"
              className="w-[11rem]"
              value={monthKey}
              onChange={(event) => setSearchParams({ month: event.target.value })}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="次月"
              onClick={() => {
                const [yearText, monthText] = monthKey.split('-')
                const baseDate = new Date(Number(yearText), Number(monthText), 1)
                setSearchParams({ month: `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}` })
              }}
            >
              <span aria-hidden="true">&gt;</span>
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {days.map((day) => (
            <Card key={day.dateKey}>
              <button
                type="button"
                aria-label={`${day.dateKey} の行動ログを見る`}
                className="w-full text-left transition hover:bg-slate-50"
                onClick={() => navigate(`/records/activity/day/${day.dateKey}`)}
              >
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-base font-bold text-slate-900">{day.dateKey}</div>
                    <CalendarDays className="h-4 w-4 text-violet-500" />
                  </div>
                  <div className="text-sm text-slate-600">{day.dailyLog.summary}</div>
                  <div className="flex flex-wrap gap-2">
                    {day.dailyLog.mainThemes.map((theme) => (
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
      </div>
    </Screen>
  )
}

function ReviewYearView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const year = normalizeYear(searchParams.get('year'))
  const reviews = useMemo(() => getWeeklyActivityReviewYearMocks(year), [year])

  return (
    <Screen
      title="週次行動レビュー一覧"
      subtitle="年ごとの一覧と、週詳細への入口だけを mock で確認します。"
    >
      <div className="space-y-4 pb-6">
        <MockNotice label="review/year mock route" />
        <h2 className="text-xl font-bold text-slate-900">週次行動レビュー一覧</h2>
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target Year</div>
            <div className="mt-1 text-lg font-bold text-slate-900">対象年: {year}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="前年" onClick={() => setSearchParams({ year: String(year - 1) })}>
              <span aria-hidden="true">&lt;</span>
            </Button>
            <Input
              type="number"
              aria-label="対象年ピッカー"
              className="w-[8rem]"
              value={String(year)}
              onChange={(event) => setSearchParams({ year: event.target.value })}
            />
            <Button variant="outline" size="icon" aria-label="次年" onClick={() => setSearchParams({ year: String(year + 1) })}>
              <span aria-hidden="true">&gt;</span>
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          {reviews.map((review) => (
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
          ))}
        </div>
      </div>
    </Screen>
  )
}

function SearchView() {
  const results = useMemo(() => getActivitySearchMockResults(), [])

  return (
    <Screen
      title="行動ログ検索"
      subtitle="検索フォームと結果一覧の雰囲気だけを mock で確認します。"
    >
      <div className="space-y-4 pb-6">
        <MockNotice label="search mock route" />
        <h2 className="text-xl font-bold text-slate-900">行動ログ検索</h2>
        <Card>
          <CardContent className="space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</div>
            <div className="flex gap-2">
              <Input placeholder="キーワードで検索" aria-label="キーワードで検索" defaultValue="mock" />
              <Button variant="outline" size="icon" aria-label="検索">
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-3">
              {results.map((session) => (
                <div key={session.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">{session.title}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatDateTime(session.startedAt, 'M/d HH:mm')} - {formatDateTime(session.endedAt, 'HH:mm')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {session.domains.map((domain) => (
                      <Badge key={`${session.id}_${domain}`} tone="outline">
                        {domain}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </Screen>
  )
}

function ReviewWeekView({ weekKey }: { weekKey: string }) {
  const review = useMemo(() => getWeeklyActivityReviewMock(weekKey), [weekKey])

  return (
    <Screen
      title="週次行動レビュー詳細"
      subtitle="個別週の表示枠と、年一覧からの詳細導線を mock で確認します。"
    >
      <div className="space-y-4 pb-6">
        <MockNotice label="review/week mock route" />
        <h2 className="text-xl font-bold text-slate-900">週次行動レビュー詳細</h2>
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">WeeklyActivityReview</div>
                <div className="mt-1 text-lg font-bold text-slate-900">週キー: {review.weekKey}</div>
              </div>
              <Sparkles className="h-5 w-5 text-violet-500" />
            </div>
            <p className="text-sm leading-6 text-slate-600">{review.summary}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {review.categoryDurations.map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">{item.minutes}分</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {review.focusThemes.map((theme) => (
                <Badge key={theme} tone="warning">
                  {theme}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </Screen>
  )
}

export function ActivityLogMockScreen({ variant }: { variant: ActivityLogMockVariant }) {
  const params = useParams()
  const [searchParams] = useSearchParams()

  if (variant === 'today') {
    return <TodayOrDayView variant="today" dateKey={getDayKey(new Date())} />
  }

  if (variant === 'day') {
    return <TodayOrDayView variant="day" dateKey={params.dateKey ?? getDayKey(new Date())} />
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

  return <ReviewWeekView weekKey={searchParams.get('weekKey') ?? getWeekKey(new Date())} />
}
