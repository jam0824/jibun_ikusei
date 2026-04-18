export type ActivityLogViewMode = 'session' | 'event'

export type ActivityRawEventMock = {
  id: string
  occurredAt: string
  appName: string
  windowTitle: string
  domain?: string
}

export type ActivitySessionMock = {
  id: string
  startedAt: string
  endedAt: string
  title: string
  primaryCategory: '仕事' | '学習' | '創作'
  appNames: string[]
  domains: string[]
}

export type DailyActivityLogMock = {
  dateKey: string
  summary: string
  mainThemes: string[]
  notePreview: string
}

export type WeeklyActivityReviewMock = {
  weekKey: string
  summary: string
  focusThemes: string[]
  categoryDurations: Array<{ label: string; minutes: number }>
}

export type WeeklyActivityReviewListItemMock = WeeklyActivityReviewMock & {
  year: number
}

export type ActivityDayMock = {
  dateKey: string
  rawEvents: ActivityRawEventMock[]
  sessions: ActivitySessionMock[]
  dailyLog: DailyActivityLogMock
}

const SESSION_TEMPLATE: Omit<ActivitySessionMock, 'id' | 'startedAt' | 'endedAt'>[] = [
  {
    title: '行動ログ mock 画面の導線確認',
    primaryCategory: '仕事',
    appNames: ['Chrome', 'VS Code'],
    domains: ['github.com', 'localhost'],
  },
  {
    title: 'route と screen 構成のメモ整理',
    primaryCategory: '学習',
    appNames: ['Notion'],
    domains: ['notion.so'],
  },
]

const RAW_EVENT_TEMPLATE: Omit<ActivityRawEventMock, 'id' | 'occurredAt'>[] = [
  {
    appName: 'Chrome',
    windowTitle: 'GitHub - activity log mock',
    domain: 'github.com',
  },
  {
    appName: 'VS Code',
    windowTitle: 'records/activity route mock',
  },
  {
    appName: 'Notion',
    windowTitle: '行動ログ Phase 0 メモ',
    domain: 'notion.so',
  },
]

export function getActivityDayMock(dateKey: string): ActivityDayMock {
  const hour = (value: number) => String(value).padStart(2, '0')

  return {
    dateKey,
    rawEvents: RAW_EVENT_TEMPLATE.map((event, index) => ({
      id: `raw_${dateKey}_${index + 1}`,
      occurredAt: `${dateKey}T${hour(9 + index)}:1${index}:00+09:00`,
      ...event,
    })),
    sessions: SESSION_TEMPLATE.map((session, index) => ({
      id: `session_${dateKey}_${index + 1}`,
      startedAt: `${dateKey}T${hour(9 + index)}:00:00+09:00`,
      endedAt: `${dateKey}T${hour(9 + index)}:45:00+09:00`,
      ...session,
    })),
    dailyLog: {
      dateKey,
      summary: '午前は route の形を確認しつつ、午後は mock 表示に必要な最小データを整理していた。',
      mainThemes: ['route 確認', 'mock UI', 'deep link 着地'],
      notePreview: '手動メモ枠の見た目だけ先に置いて、保存は後続フェーズで実装する。',
    },
  }
}

export function getCalendarDayMocks(): ActivityDayMock[] {
  return ['2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18'].map(getActivityDayMock)
}

export function getCalendarDayMocksByMonth(monthKey: string): ActivityDayMock[] {
  const [yearText, monthText] = monthKey.split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return getCalendarDayMocks()
  }

  return [3, 10, 17, 24].map((day) =>
    getActivityDayMock(`${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`),
  )
}

export function getWeeklyActivityReviewMock(weekKey: string): WeeklyActivityReviewMock {
  return {
    weekKey,
    summary: 'mock 期間中は route 設計と画面の骨組みづくりが中心で、細かなデータ接続はまだ行っていない。',
    focusThemes: ['PWA mock route', 'records/activity deep link', 'DailyActivityLog 表示枠'],
    categoryDurations: [
      { label: '仕事', minutes: 220 },
      { label: '学習', minutes: 95 },
      { label: '創作', minutes: 45 },
    ],
  }
}

export function getWeeklyActivityReviewYearMocks(year: number): WeeklyActivityReviewListItemMock[] {
  return ['W14', 'W15', 'W16', 'W17'].map((weekPart, index) => {
    const weekKey = `${year}-${weekPart}`
    const review = getWeeklyActivityReviewMock(weekKey)

    return {
      ...review,
      year,
      summary:
        index === 0
          ? '春先は route 設計の整理が中心で、動線の全体像をゆっくり固めていた。'
          : index === 1
            ? 'PWA mock の見た目を確認しながら、records 配下の導線を少しずつ揃えていた。'
            : index === 2
              ? '行動ログカレンダーと週次レビューの入口を見直し、見返しやすい形へ寄せていた。'
              : '年の後半を見据えて、mock と本実装の境界を丁寧に分ける流れが続いていた。',
    }
  })
}

export function getActivitySearchMockResults() {
  return [
    getActivityDayMock('2026-04-17').sessions[0],
    getActivityDayMock('2026-04-16').sessions[1],
  ]
}
