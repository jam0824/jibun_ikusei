import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppShellRoutes } from '@/App'
import { hydratePersistedState } from '@/domain/logic'
import type {
  ActivitySession,
  DailyActivityLog,
  OpenLoop,
  RawEvent,
  WeeklyActivityReview,
} from '@/domain/action-log-types'
import type { PersistedAppState, Quest, QuestCompletion } from '@/domain/types'
import * as api from '@/lib/api-client'
import * as ai from '@/lib/ai'
import { useAppStore } from '@/store/app-store'
import type { HealthDataEntry, SituationLogEntry } from '@/lib/api-client'

function createQuest(id: string, title: string): Quest {
  const now = '2026-04-17T09:00:00+09:00'
  return {
    id,
    title,
    description: `${title} のメモ`,
    questType: 'repeatable',
    xpReward: 5,
    category: '学習',
    skillMappingMode: 'ask_each_time',
    cooldownMinutes: 0,
    dailyCompletionCap: 10,
    status: 'active',
    privacyMode: 'normal',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }
}

function createCompletion(id: string, questId: string, completedAt: string): QuestCompletion {
  return {
    id,
    questId,
    clientRequestId: `req_${id}`,
    completedAt,
    userXpAwarded: 5,
    skillResolutionStatus: 'resolved',
    createdAt: completedAt,
  }
}

function resetStore(partial: Partial<PersistedAppState>) {
  const base = hydratePersistedState({
    meta: {
      schemaVersion: 1,
      seededSampleData: true,
      ...partial.meta,
    },
    quests: [],
    completions: [],
    skills: [],
    assistantMessages: [],
    personalSkillDictionary: [],
    ...partial,
  })

  useAppStore.setState((state) => ({
    ...state,
    ...base,
    hydrated: true,
    importMode: 'merge',
    currentEffectCompletionId: undefined,
    busyQuestId: undefined,
    connectionState: {
      openai: { status: 'idle' },
      gemini: { status: 'idle' },
    },
    nutritionCache: {},
    fitbitCache: {},
  }))
}

function createSession(id: string, overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id,
    deviceId: 'device_main',
    startedAt: '2026-04-17T09:00:00+09:00',
    endedAt: '2026-04-17T09:40:00+09:00',
    dateKey: '2026-04-17',
    title: 'Chrome 拡張の調査',
    primaryCategory: '学習',
    activityKinds: ['調査'],
    appNames: ['Chrome'],
    domains: ['developer.chrome.com'],
    projectNames: [],
    summary: 'Chrome 拡張の調査を進めていた。',
    searchKeywords: ['Chrome拡張', 'developer.chrome.com'],
    noteIds: [],
    openLoopIds: ['open_loop_1'],
    hidden: false,
    ...overrides,
  }
}

function createRawEvent(id: string, overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id,
    deviceId: 'device_main',
    source: 'chrome_extension',
    eventType: 'browser_page_changed',
    occurredAt: '2026-04-17T09:05:00+09:00',
    appName: 'Chrome',
    windowTitle: 'Manifest V3 - Chrome for Developers',
    url: 'https://developer.chrome.com/docs/extensions/mv3/intro',
    domain: 'developer.chrome.com',
    metadata: {},
    expiresAt: '2026-05-17T09:05:00+09:00',
    ...overrides,
  }
}

function createDailyLog(dateKey = '2026-04-17', overrides: Partial<DailyActivityLog> = {}): DailyActivityLog {
  return {
    id: `daily_${dateKey}`,
    dateKey,
    summary: 'リリィは、この日の調査に静かな集中が集まっていたと見ている。',
    questSummary: 'リリィは、この日のクエスト達成が小さな区切りをいくつか残していたと見ている。',
    healthSummary: 'リリィは、この日の健康記録が静かに朝の輪郭を残していたと見ている。',
    mainThemes: ['Chrome拡張', '調査'],
    noteIds: [],
    openLoopIds: ['open_loop_1'],
    reviewQuestions: ['次に確認したい仕様はどこだったか。'],
    generatedAt: `${dateKey}T22:00:00+09:00`,
    ...overrides,
  }
}

function createWeeklyReview(weekKey = '2026-W16', overrides: Partial<WeeklyActivityReview> = {}): WeeklyActivityReview {
  return {
    id: `weekly_${weekKey}`,
    weekKey,
    summary: 'リリィは、この週には調査と実装の往復がゆっくり深まっていたと見ている。',
    categoryDurations: {
      学習: 180,
      仕事: 120,
    },
    focusThemes: ['Chrome拡張', '開発'],
    openLoopIds: ['open_loop_1'],
    generatedAt: '2026-04-18T08:00:00+09:00',
    ...overrides,
  }
}

function createOpenLoop(id = 'open_loop_1', overrides: Partial<OpenLoop> = {}): OpenLoop {
  return {
    id,
    createdAt: '2026-04-17T09:40:00+09:00',
    updatedAt: '2026-04-17T09:40:00+09:00',
    dateKey: '2026-04-17',
    title: '権限設定の確認',
    description: 'manifest の権限設定を次に確認する。',
    status: 'open',
    linkedSessionIds: ['session_1'],
    ...overrides,
  }
}

function createHealthDataEntry(overrides: Partial<HealthDataEntry> = {}): HealthDataEntry {
  return {
    date: '2026-04-16',
    time: '07:15',
    weight_kg: 61.2,
    body_fat_pct: 18.1,
    source: 'health-planet',
    ...overrides,
  }
}

function createSituationLog(
  timestamp = '2026-04-17T18:30:00+09:00',
  overrides: Partial<SituationLogEntry> = {},
): SituationLogEntry {
  return {
    summary: '直近30分は実装と確認を落ち着いて行き来していた。',
    timestamp,
    details: {
      active_apps: ['Code', 'Chrome'],
    },
    ...overrides,
  }
}

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationDisplay />
      <AppShellRoutes />
    </MemoryRouter>,
  )
}

function getSessionCard(sessionId: string) {
  return screen.getByTestId(`activity-session-${sessionId}`)
}

function createSessionBatch(
  total: number,
  options?: {
    startIndex?: number
    overrides?: Partial<ActivitySession>
  },
) {
  return Array.from({ length: total }, (_, index) => {
    const sequence = (options?.startIndex ?? 0) + index
    const totalMinutes = 23 * 60 + 59 - sequence * 10
    const startedHour = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
    const startedMinute = String(totalMinutes % 60).padStart(2, '0')
    const sessionNumber = String(sequence + 1).padStart(3, '0')
    return createSession(`session_${sessionNumber}`, {
      startedAt: `2026-04-17T${startedHour}:${startedMinute}:00+09:00`,
      endedAt: `2026-04-17T${startedHour}:${startedMinute}:59+09:00`,
      title: `Session ${sessionNumber}`,
      summary: undefined,
      searchKeywords: [`session_${sessionNumber}`],
      ...options?.overrides,
    })
  })
}

function createCompactableSessionBurst() {
  return [
    createSession('youtube_1', {
      startedAt: '2026-04-17T14:19:00+09:00',
      endedAt: '2026-04-17T14:19:15+09:00',
      title: 'YouTube page 1',
      summary: undefined,
      primaryCategory: '娯楽',
      activityKinds: ['視聴'],
      appNames: ['chrome.exe'],
      domains: ['youtube.com'],
    }),
    createSession('codex_1', {
      startedAt: '2026-04-17T14:18:45+09:00',
      endedAt: '2026-04-17T14:18:58+09:00',
      title: 'Codex work 1',
      summary: undefined,
      primaryCategory: '仕事',
      activityKinds: ['開発'],
      appNames: ['Codex.exe'],
      domains: [],
    }),
    createSession('youtube_2', {
      startedAt: '2026-04-17T14:18:20+09:00',
      endedAt: '2026-04-17T14:18:35+09:00',
      title: 'YouTube page 2',
      summary: undefined,
      primaryCategory: '娯楽',
      activityKinds: ['視聴'],
      appNames: ['chrome.exe'],
      domains: ['youtube.com'],
    }),
    createSession('codex_2', {
      startedAt: '2026-04-17T14:18:00+09:00',
      endedAt: '2026-04-17T14:18:10+09:00',
      title: 'Codex work 2',
      summary: undefined,
      primaryCategory: '仕事',
      activityKinds: ['開発'],
      appNames: ['Codex.exe'],
      domains: [],
    }),
    createSession('youtube_3', {
      startedAt: '2026-04-17T14:17:35+09:00',
      endedAt: '2026-04-17T14:17:50+09:00',
      title: 'YouTube page 3',
      summary: undefined,
      primaryCategory: '娯楽',
      activityKinds: ['視聴'],
      appNames: ['chrome.exe'],
      domains: ['youtube.com'],
    }),
    createSession('codex_3', {
      startedAt: '2026-04-17T14:17:10+09:00',
      endedAt: '2026-04-17T14:17:25+09:00',
      title: 'Codex work 3',
      summary: undefined,
      primaryCategory: '仕事',
      activityKinds: ['開発'],
      appNames: ['Codex.exe'],
      domains: [],
    }),
  ]
}

function createRawEventBatch(total: number, startIndex = 0) {
  return Array.from({ length: total }, (_, index) => {
    const sequence = startIndex + index
    const eventNumber = String(sequence + 1).padStart(3, '0')
    const totalMinutes = 23 * 60 + 59 - sequence
    const hour = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
    const minute = String(totalMinutes % 60).padStart(2, '0')
    return createRawEvent(`event_${eventNumber}`, {
      occurredAt: `2026-04-17T${hour}:${minute}:00+09:00`,
      windowTitle: `Event ${eventNumber}`,
    })
  })
}

async function settleApp() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('activity log routes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-17T09:00:00+09:00'))
    window.localStorage.clear()

    resetStore({
      quests: [createQuest('quest_today', '今日の読書')],
      completions: [createCompletion('completion_today', 'quest_today', '2026-04-17T08:30:00+09:00')],
    })

    vi.spyOn(api, 'getActionLogRawEvents').mockResolvedValue([
      createRawEvent('event_1'),
      createRawEvent('event_2', {
        id: 'event_2',
        occurredAt: '2026-04-17T09:18:00+09:00',
        eventType: 'heartbeat',
        metadata: { elapsedSeconds: 180 },
      }),
    ])
    vi.spyOn(api, 'getActionLogRawEventsPage').mockResolvedValue({
      items: [
        createRawEvent('event_2', {
          id: 'event_2',
          occurredAt: '2026-04-17T09:18:00+09:00',
          eventType: 'heartbeat',
          metadata: { elapsedSeconds: 180 },
        }),
        createRawEvent('event_1'),
      ],
      nextCursor: null,
    })
    vi.spyOn(api, 'getActionLogSessions').mockResolvedValue([
      createSession('session_1'),
      createSession('session_2', {
        id: 'session_2',
        startedAt: '2026-04-16T21:00:00+09:00',
        endedAt: '2026-04-16T21:30:00+09:00',
        dateKey: '2026-04-16',
        title: '昨日の実装メモ',
        primaryCategory: '仕事',
        activityKinds: ['開発'],
        appNames: ['Code'],
        domains: [],
        searchKeywords: ['昨日', '実装'],
        openLoopIds: [],
      }),
    ])
    vi.spyOn(api, 'getActionLogSessionsPage').mockResolvedValue({
      items: [createSession('session_1')],
      nextCursor: null,
    })
    vi.spyOn(api, 'getActionLogDailyActivityLog').mockImplementation(async (dateKey) => {
      if (dateKey === '2026-04-17') {
        return createDailyLog('2026-04-17')
      }
      return null
    })
    vi.spyOn(api, 'getActionLogDailyActivityLogs').mockResolvedValue([
      createDailyLog('2026-04-03', { summary: '前月の記録', mainThemes: ['前月'] }),
      createDailyLog('2026-04-17'),
    ])
    vi.spyOn(api, 'getActionLogWeeklyActivityReview').mockImplementation(async (weekKey) => {
      if (weekKey === '2026-W16') {
        return createWeeklyReview('2026-W16')
      }
      return null
    })
    vi.spyOn(api, 'getActionLogWeeklyActivityReviews').mockResolvedValue([
      createWeeklyReview('2026-W15', { summary: '前週のまとめ', focusThemes: ['前週'] }),
      createWeeklyReview('2026-W16'),
    ])
    vi.spyOn(api, 'putActionLogDailyActivityLog').mockImplementation(async (log) => log)
    vi.spyOn(api, 'putActionLogWeeklyActivityReview').mockImplementation(async (review) => review)
    vi.spyOn(api, 'putActionLogSessionHidden').mockImplementation(async (id, input) =>
      createSession(id, {
        id,
        dateKey: input.dateKey,
        hidden: input.hidden,
      }),
    )
    vi.spyOn(api, 'deleteActionLogRange').mockResolvedValue({
      deleted: {
        rawEvents: 1,
        sessions: 1,
        dailyLogs: 1,
        weeklyReviews: 1,
        openLoops: 1,
        situationLogs: 1,
      },
      deletionRequestId: 'delete_1',
    })
    vi.spyOn(api, 'getCompletions').mockResolvedValue([
      createCompletion('completion_yesterday', 'quest_today', '2026-04-16T08:30:00+09:00'),
    ])
    vi.spyOn(api, 'getActionLogOpenLoops').mockResolvedValue([
      createOpenLoop(),
      createOpenLoop('open_loop_2', {
        title: '検索画面の open loop',
        dateKey: '2026-04-16',
        linkedSessionIds: ['session_2'],
      }),
    ])
    vi.spyOn(api, 'getBrowsingTimes').mockResolvedValue([])
    vi.spyOn(api, 'getHealthData').mockResolvedValue([createHealthDataEntry()])
    vi.spyOn(api, 'getNutrition').mockResolvedValue({
      daily: null,
      breakfast: null,
      lunch: null,
      dinner: null,
    })
    vi.spyOn(api, 'getFitbitData').mockResolvedValue([])
    vi.spyOn(api, 'getQuests').mockResolvedValue([createQuest('quest_today', '今日の読書')])
    vi.spyOn(api, 'getSituationLogs').mockResolvedValue([
      createSituationLog('2026-04-17T18:00:00+09:00', { summary: '少し前の30分まとめ' }),
      createSituationLog('2026-04-17T19:00:00+09:00', { summary: '最新の30分まとめ' }),
    ])

    vi.spyOn(ai, 'generateDailyActivityLog').mockResolvedValue({
      provider: 'template',
      summary: 'リリィは、前日の調査の流れを静かに見つめていた。',
      questSummary: 'リリィは、前日のクエスト達成が小さな区切りを作っていたと見ている。',
      healthSummary: 'リリィは、前日の健康記録が朝の輪郭を静かに残していたと見ている。',
      mainThemes: ['Chrome拡張', '調査'],
      reviewQuestions: ['次に確認したい仕様はどこだったか。'],
    })
    vi.spyOn(ai, 'generateWeeklyActivityReview').mockResolvedValue({
      provider: 'template',
      summary: 'リリィは、前週の調査と実装の往復を見つめていた。',
      focusThemes: ['Chrome拡張', '開発'],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the records hub at /records without restoring a previous child route', async () => {
    window.localStorage.setItem('app.records.lastRoute', '/records/activity/search')

    renderApp('/records')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records')
    expect(screen.getByText('見返したい記録の入口をここにまとめています。')).toBeInTheDocument()
  })

  it('redirects the legacy quest records route to the canonical growth route', async () => {
    renderApp('/records/quests?range=week')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/growth?range=week')
  })

  it('renders the growth records route at /records/growth', () => {
    renderApp('/records/growth?range=week')
    expect(screen.getAllByText('今日の読書').length).toBeGreaterThan(0)
  })

  it('redirects the legacy browsing route under activity to the life browsing route', async () => {
    renderApp('/records/activity/browsing?period=week&date=2026-04-17')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/life/browsing?period=week&date=2026-04-17')
  })

  it('reads the browsing period from query params on the life-log route and keeps the date anchor', async () => {
    renderApp('/records/life/browsing?period=week&date=2026-04-17')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/life/browsing?period=week&date=2026-04-17')
    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-04-11', '2026-04-17')

    fireEvent.click(screen.getByRole('button', { name: '全期間' }))
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/life/browsing?period=all&date=2026-04-17')
    expect(api.getBrowsingTimes).toHaveBeenLastCalledWith('2020-01-01', '2026-04-17')
  })

  it('reads the date query on the nutrition life-log route', async () => {
    vi.mocked(api.getNutrition).mockResolvedValue({
      daily: {
        userId: 'user_1',
        date: '2026-04-15',
        mealType: 'daily',
        nutrients: {
          energy: { value: 500, unit: 'kcal', label: '適正', threshold: null },
          protein: { value: 20, unit: 'g', label: '適正', threshold: null },
          fat: { value: 10, unit: 'g', label: '適正', threshold: null },
          carbs: { value: 60, unit: 'g', label: '適正', threshold: null },
          potassium: { value: 1000, unit: 'mg', label: '不足', threshold: null },
          calcium: { value: 700, unit: 'mg', label: '適正', threshold: null },
          iron: { value: 8, unit: 'mg', label: '適正', threshold: null },
          vitaminA: { value: 700, unit: 'µg', label: '適正', threshold: null },
          vitaminE: { value: 6, unit: 'mg', label: '適正', threshold: null },
          vitaminB1: { value: 0.8, unit: 'mg', label: '不足', threshold: null },
          vitaminB2: { value: 1.2, unit: 'mg', label: '適正', threshold: null },
          vitaminB6: { value: 1.1, unit: 'mg', label: '適正', threshold: null },
          vitaminC: { value: 90, unit: 'mg', label: '適正', threshold: null },
          fiber: { value: 15, unit: 'g', label: '不足', threshold: null },
          saturatedFat: { value: 7, unit: 'g', label: '適正', threshold: null },
          salt: { value: 9, unit: 'g', label: '過剰', threshold: null },
        },
        createdAt: '2026-04-15T12:00:00+09:00',
        updatedAt: '2026-04-15T12:00:00+09:00',
      },
      breakfast: null,
      lunch: null,
      dinner: null,
    })

    renderApp('/records/life/nutrition?date=2026-04-15')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/life/nutrition?date=2026-04-15')
    expect(api.getNutrition).toHaveBeenCalledWith('2026-04-15')
    expect(screen.getByText('2026年4月15日')).toBeInTheDocument()
    expect(screen.getByText('表示元: 1日分')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '栄養' })).toHaveClass('bg-violet-50')
    expect(screen.getByRole('link', { name: '栄養' })).toHaveClass('text-violet-700')
    expect(screen.getByRole('link', { name: '栄養' })).toHaveClass('border-violet-200')
    expect(screen.getByRole('link', { name: '閲覧' })).toHaveAttribute(
      'href',
      '/records/life/browsing?period=day&date=2026-04-15',
    )
  })

  it('reads the date query on the health life-log route', async () => {
    vi.mocked(api.getFitbitData).mockResolvedValue([
      {
        date: '2026-04-14',
        heart: {
          resting_heart_rate: 58,
          intraday_points: 0,
          heart_zones: [],
        },
        active_zone_minutes: null,
        sleep: null,
        activity: {
          steps: 8123,
          distance: 5.4,
          calories: 2100,
          very_active_minutes: 12,
          fairly_active_minutes: 18,
          lightly_active_minutes: 30,
          sedentary_minutes: 500,
        },
      },
    ])

    renderApp('/records/life/health?date=2026-04-14')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/life/health?date=2026-04-14')
    expect(api.getFitbitData).toHaveBeenCalledWith('2026-04-14', '2026-04-14')
    expect(screen.getByText('2026年4月14日')).toBeInTheDocument()
    expect(screen.getByText('8,123 歩')).toBeInTheDocument()
  })

  it('renders the today activity screen without generating a missing daily log', async () => {
    vi.mocked(api.getActionLogDailyActivityLog).mockResolvedValueOnce(null)

    renderApp('/records/activity/today')
    await settleApp()
    expect(screen.getByText('対象日: 2026-04-17')).toBeInTheDocument()
    expect(screen.getByText('その日のまとめ')).toBeInTheDocument()
    expect(api.putActionLogDailyActivityLog).not.toHaveBeenCalled()
  })

  it('renders the three-part daily summary in order on day views', async () => {
    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    const summary = screen.getByText('リリィは、この日の調査に静かな集中が集まっていたと見ている。')
    const questSummary = screen.getByText(
      'リリィは、この日のクエスト達成が小さな区切りをいくつか残していたと見ている。',
    )
    const healthSummary = screen.getByText(
      'リリィは、この日の健康記録が静かに朝の輪郭を残していたと見ている。',
    )

    expect(summary.compareDocumentPosition(questSummary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(questSummary.compareDocumentPosition(healthSummary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('次に確認したい仕様はどこだったか。')).not.toBeInTheDocument()
  })

  it('renders same-day situation logs newest first only in session view', async () => {
    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    const newest = screen.getByText('最新の30分まとめ')
    const older = screen.getByText('少し前の30分まとめ')
    const sessionTimeline = screen.getByText('セッション表示')

    expect(newest.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(older.compareDocumentPosition(sessionTimeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('switches to raw event display when view=event is specified', async () => {
    renderApp('/records/activity/today?view=event')
    await settleApp()

    expect(screen.getByText('イベント表示')).toBeInTheDocument()
    expect(screen.getAllByText('Chrome / Manifest V3 - Chrome for Developers').length).toBeGreaterThan(0)
    expect(api.getActionLogRawEventsPage).toHaveBeenCalledTimes(1)
    expect(api.getActionLogSessionsPage).not.toHaveBeenCalled()
  })

  it('does not render situation logs in event view', async () => {
    renderApp('/records/activity/today?view=event')
    await settleApp()

    expect(screen.queryByText('最新の30分まとめ')).not.toBeInTheDocument()
    expect(screen.queryByText('少し前の30分まとめ')).not.toBeInTheDocument()
  })

  it('keeps the target date and session-event toggle in the same target row', async () => {
    renderApp('/records/activity/today')
    await settleApp()

    const targetRow = screen.getByTestId('activity-day-target-row')

    expect(within(targetRow).getByText('対象日: 2026-04-17')).toBeInTheDocument()
    expect(within(targetRow).getByRole('button', { name: 'session' })).toBeInTheDocument()
    expect(within(targetRow).getByRole('button', { name: 'event' })).toBeInTheDocument()
  })

  it('compacts short alternating YouTube and Codex sessions into two cards on day views', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockResolvedValue({
      items: createCompactableSessionBurst(),
      nextCursor: null,
    })

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    expect(screen.getByText('YouTubeで動画を視聴')).toBeInTheDocument()
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(2)
    expect(screen.getByText('Codexでコード作業')).toBeInTheDocument()
    expect(screen.getAllByText('3件')).toHaveLength(2)
    expect(screen.queryByText(/表示中:/)).not.toBeInTheDocument()
  })

  it('does not render hide buttons on today session cards', async () => {
    renderApp('/records/activity/today')
    await settleApp()

    expect(screen.queryByRole('button', { name: 'Hide session session_1' })).not.toBeInTheDocument()
  })

  it('shows only the first page of sessions until more is requested', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockResolvedValue({
      items: createSessionBatch(50),
      nextCursor: 'cursor_sessions_2',
    })

    renderApp('/records/activity/today')
    await settleApp()

    expect(screen.getByTestId('activity-session-session_001')).toBeInTheDocument()
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(50)
    expect(screen.queryByText(/表示中:/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'さらに50件表示' })).toBeInTheDocument()
    expect(screen.queryByTestId('activity-session-session_051')).not.toBeInTheDocument()
  })

  it('fetches the next session page after pressing load more', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockImplementation(async ({ cursor }) => {
      if (cursor === 'cursor_sessions_2') {
        return {
          items: createSessionBatch(25, { startIndex: 50 }),
          nextCursor: null,
        }
      }
      return {
        items: createSessionBatch(50),
        nextCursor: 'cursor_sessions_2',
      }
    })

    renderApp('/records/activity/today')
    await settleApp()

    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
    await settleApp()

    expect(screen.getByTestId('activity-session-session_051')).toBeInTheDocument()
    expect(api.getActionLogSessionsPage).toHaveBeenNthCalledWith(1, {
      from: '2026-04-17',
      to: '2026-04-17',
      limit: 50,
      cursor: undefined,
      includeHidden: false,
    })
    expect(api.getActionLogSessionsPage).toHaveBeenNthCalledWith(2, {
      from: '2026-04-17',
      to: '2026-04-17',
      limit: 50,
      cursor: 'cursor_sessions_2',
      includeHidden: false,
    })
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(75)
    expect(screen.queryByRole('button', { name: 'さらに50件表示' })).not.toBeInTheDocument()
  })

  it('keeps session and event page state separate and lazily loads the inactive view on first switch', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockImplementation(async ({ cursor }) => {
      if (cursor === 'cursor_sessions_2') {
        return {
          items: createSessionBatch(20, { startIndex: 50 }),
          nextCursor: null,
        }
      }
      return {
        items: createSessionBatch(50),
        nextCursor: 'cursor_sessions_2',
      }
    })
    vi.mocked(api.getActionLogRawEventsPage).mockResolvedValue({
      items: createRawEventBatch(50),
      nextCursor: 'cursor_events_2',
    })

    renderApp('/records/activity/today')
    await settleApp()

    expect(screen.getByTestId('activity-session-session_001')).toBeInTheDocument()
    expect(api.getActionLogSessionsPage).toHaveBeenCalledTimes(1)
    expect(api.getActionLogRawEventsPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
    await settleApp()
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(70)

    fireEvent.click(screen.getByRole('button', { name: 'event' }))
    await settleApp()

    expect(screen.getByTestId('activity-event-event_001')).toBeInTheDocument()
    expect(api.getActionLogRawEventsPage).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId(/activity-event-/)).toHaveLength(50)
    expect(screen.queryByTestId('activity-event-event_051')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'session' }))
    await settleApp()

    expect(screen.getByTestId('activity-session-session_051')).toBeInTheDocument()
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(70)
  })

  it('refetches the session page from the beginning when hidden sessions are included', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockImplementation(async ({ cursor, includeHidden }) => {
      if (includeHidden) {
        return {
          items: [
            ...createSessionBatch(49),
            createSession('session_hidden_day', {
              id: 'session_hidden_day',
              hidden: true,
              title: 'Hidden Session 001',
            }),
          ],
          nextCursor: null,
        }
      }
      if (cursor === 'cursor_sessions_2') {
        return {
          items: createSessionBatch(20, { startIndex: 50 }),
          nextCursor: null,
        }
      }
      return {
        items: createSessionBatch(50),
        nextCursor: 'cursor_sessions_2',
      }
    })

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    expect(screen.getByTestId('activity-session-session_001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
    await settleApp()
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(70)

    fireEvent.click(screen.getByRole('switch', { name: 'Include hidden sessions in timeline' }))
    await settleApp()

    expect(screen.getByText('Hidden Session 001')).toBeInTheDocument()
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(50)
    expect(api.getActionLogSessionsPage).toHaveBeenLastCalledWith({
      from: '2026-04-17',
      to: '2026-04-17',
      limit: 50,
      cursor: undefined,
      includeHidden: true,
    })
  })

  it('shows newer sessions above older ones on the today timeline', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockResolvedValue({
      items: [
        createSession('session_new', {
          startedAt: '2026-04-17T11:00:00+09:00',
          endedAt: '2026-04-17T11:20:00+09:00',
          title: 'Newer session',
          summary: 'Newer session summary.',
        }),
        createSession('session_old', {
          startedAt: '2026-04-17T09:00:00+09:00',
          endedAt: '2026-04-17T09:20:00+09:00',
          title: 'Older session',
          summary: 'Older session summary.',
        }),
      ],
      nextCursor: null,
    })

    renderApp('/records/activity/today')
    await settleApp()

    const newerCard = screen.getByTestId('activity-session-session_new')
    const olderCard = screen.getByTestId('activity-session-session_old')

    expect(newerCard.compareDocumentPosition(olderCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows newer raw events above older ones on the day event timeline', async () => {
    vi.mocked(api.getActionLogRawEventsPage).mockResolvedValue({
      items: [
        createRawEvent('event_new', {
          occurredAt: '2026-04-17T11:05:00+09:00',
          windowTitle: 'Newer event title',
        }),
        createRawEvent('event_old', {
          occurredAt: '2026-04-17T09:05:00+09:00',
          windowTitle: 'Older event title',
        }),
      ],
      nextCursor: null,
    })

    renderApp('/records/activity/day/2026-04-17?view=event')
    await settleApp()

    const newerTitle = screen.getByText('Chrome / Newer event title')
    const olderTitle = screen.getByText('Chrome / Older event title')

    expect(newerTitle.compareDocumentPosition(olderTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not render restore buttons on day session cards even when hidden sessions are included', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockImplementation(async ({ includeHidden }) => ({
      items: includeHidden
        ? [
            createSession('session_hidden_day', {
              id: 'session_hidden_day',
              hidden: true,
            }),
          ]
        : [],
      nextCursor: null,
    }))

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    fireEvent.click(screen.getByRole('switch', { name: 'Include hidden sessions in timeline' }))
    await settleApp()

    expect(screen.getByTestId('activity-session-session_hidden_day')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Restore session session_hidden_day' }),
    ).not.toBeInTheDocument()
  })

  it('generates a missing previous-day daily log only on the previous-day route', async () => {
    renderApp('/records/activity/day/2026-04-16')
    await settleApp()

    expect(ai.generateDailyActivityLog).toHaveBeenCalledTimes(1)
    expect(api.putActionLogDailyActivityLog).toHaveBeenCalledTimes(1)
  })

  it('does not generate a missing older-day daily log', async () => {
    renderApp('/records/activity/day/2026-04-15')
    await settleApp()

    expect(ai.generateDailyActivityLog).not.toHaveBeenCalled()
    expect(api.putActionLogDailyActivityLog).not.toHaveBeenCalled()
  })

  it('renders the requested month and navigates from calendar to day detail', async () => {
    renderApp('/records/activity/calendar?month=2026-04')
    await settleApp()

    expect(screen.getByText('対象月: 2026-04')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '2026-04-03 details' }))
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/day/2026-04-03')
  })

  it('shows only the daily summary text on calendar cells', async () => {
    renderApp('/records/activity/calendar?month=2026-04')
    await settleApp()

    expect(screen.getByText('リリィは、この日の調査に静かな集中が集まっていたと見ている。')).toBeInTheDocument()
    expect(screen.queryByText('Chrome拡張')).not.toBeInTheDocument()
    expect(screen.queryByText('調査')).not.toBeInTheDocument()
  })

  it('defaults calendar month to the current JST month and updates the month query from controls', async () => {
    renderApp('/records/activity/calendar')
    await settleApp()

    expect(screen.getByText('対象月: 2026-04')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await settleApp()
    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/calendar?month=2026-03')

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await settleApp()
    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/calendar?month=2026-04')
  })

  it('generates the previous-week review from the year screen only on Monday and only for the matching year', async () => {
    vi.setSystemTime(new Date('2026-04-20T09:00:00+09:00'))
    vi.mocked(api.getActionLogWeeklyActivityReview).mockResolvedValue(null)

    renderApp('/records/activity/review/year?year=2026')
    await settleApp()

    expect(ai.generateWeeklyActivityReview).toHaveBeenCalledTimes(1)
    expect(api.putActionLogWeeklyActivityReview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'weekly_2026-W16', weekKey: '2026-W16' }),
    )
  })

  it('does not generate the previous-week review from the year screen when the year differs', async () => {
    vi.setSystemTime(new Date('2026-04-20T09:00:00+09:00'))
    vi.mocked(api.getActionLogWeeklyActivityReview).mockResolvedValue(null)

    renderApp('/records/activity/review/year?year=2025')
    await settleApp()

    expect(ai.generateWeeklyActivityReview).not.toHaveBeenCalled()
    expect(api.putActionLogWeeklyActivityReview).not.toHaveBeenCalled()
  })

  it('renders the requested review year and navigates to weekly detail', async () => {
    renderApp('/records/activity/review/year?year=2026')
    await settleApp()

    expect(screen.getByText('対象年: 2026')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open 2026-W15' }))
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/review/week?weekKey=2026-W15')
  })

  it('uses the shorter 詳細 label on weekly review cards', async () => {
    renderApp('/records/activity/review/year?year=2026')
    await settleApp()

    expect(screen.getAllByText('詳細').length).toBeGreaterThan(0)
    expect(screen.queryByText('詳細を見る')).not.toBeInTheDocument()
  })

  it('canonicalizes a yearless review route to the latest available year', async () => {
    vi.setSystemTime(new Date('2026-01-05T09:00:00+09:00'))
    vi.mocked(api.getActionLogWeeklyActivityReviews).mockImplementation(async (year) => {
      if (year === 2026) {
        return []
      }
      if (year === 2025) {
        return [
          createWeeklyReview('2025-W52', {
            id: 'weekly_2025-W52',
            weekKey: '2025-W52',
            summary: '前年の最後のレビュー',
            focusThemes: ['2025'],
            generatedAt: '2025-12-29T08:00:00+09:00',
          }),
        ]
      }
      return []
    })

    renderApp('/records/activity/review/year')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/review/year?year=2025')
    expect(screen.getByText('対象年: 2025')).toBeInTheDocument()
  })

  it('generates the previous-week review from the week screen only on Monday for the previous week', async () => {
    vi.setSystemTime(new Date('2026-04-20T09:00:00+09:00'))
    vi.mocked(api.getActionLogWeeklyActivityReview).mockResolvedValue(null)

    renderApp('/records/activity/review/week?weekKey=2026-W16')
    await settleApp()

    expect(ai.generateWeeklyActivityReview).toHaveBeenCalledTimes(1)
    expect(api.putActionLogWeeklyActivityReview).toHaveBeenCalledTimes(1)
  })

  it('does not generate a non-previous-week review from the week screen', async () => {
    vi.setSystemTime(new Date('2026-04-20T09:00:00+09:00'))
    vi.mocked(api.getActionLogWeeklyActivityReview).mockResolvedValue(null)

    renderApp('/records/activity/review/week?weekKey=2026-W15')
    await settleApp()

    expect(ai.generateWeeklyActivityReview).not.toHaveBeenCalled()
    expect(api.putActionLogWeeklyActivityReview).not.toHaveBeenCalled()
  })

  it('uses a yearless weekly review nav link on activity screens and canonicalizes after navigation', async () => {
    renderApp('/records/activity/search')
    await settleApp()

    const weeklyReviewLink = screen.getByRole('link', { name: '週次レビュー' })
    expect(weeklyReviewLink.getAttribute('href')).toContain('/records/activity/review/year')
    expect(weeklyReviewLink.getAttribute('href')).not.toContain('year=')

    fireEvent.click(weeklyReviewLink)
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/review/year?year=2026')
  })

  it('renders top apps and domains on the weekly detail screen', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('week_session_1', {
        id: 'week_session_1',
        dateKey: '2026-04-14',
        startedAt: '2026-04-14T09:00:00+09:00',
        endedAt: '2026-04-14T10:10:00+09:00',
        appNames: ['Chrome'],
        domains: ['developer.chrome.com'],
      }),
      createSession('week_session_2', {
        id: 'week_session_2',
        dateKey: '2026-04-15',
        startedAt: '2026-04-15T13:00:00+09:00',
        endedAt: '2026-04-15T13:20:00+09:00',
        appNames: ['Code'],
        domains: ['github.com'],
      }),
    ])

    renderApp('/records/activity/review/week?weekKey=2026-W16')
    await settleApp()

    expect(screen.getByText('よく使ったアプリ')).toBeInTheDocument()
    expect(screen.getByText('よく見ていたドメイン')).toBeInTheDocument()
    expect(screen.getByText('Chrome')).toBeInTheDocument()
    expect(screen.getByText('Code')).toBeInTheDocument()
    expect(screen.getByText('developer.chrome.com')).toBeInTheDocument()
    expect(screen.getByText('github.com')).toBeInTheDocument()
    expect(screen.getAllByText('70分')).toHaveLength(2)
    expect(screen.getAllByText('20分')).toHaveLength(2)
  })

  it('does not show open loops on the day view', async () => {
    vi.mocked(api.getActionLogOpenLoops).mockResolvedValue([
      createOpenLoop('open_loop_open', {
        id: 'open_loop_open',
        title: 'Still open loop',
      }),
      createOpenLoop('open_loop_closed', {
        id: 'open_loop_closed',
        title: 'Resolved loop',
        status: 'closed',
      }),
    ])

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    expect(screen.queryByText('Still open loop')).not.toBeInTheDocument()
    expect(screen.queryByText('Resolved loop')).not.toBeInTheDocument()
    expect(screen.queryByText('途中になっていること')).not.toBeInTheDocument()
  })

  it('does not show closed open loops on the weekly detail view', async () => {
    vi.mocked(api.getActionLogOpenLoops).mockResolvedValue([
      createOpenLoop('open_loop_open', {
        id: 'open_loop_open',
        title: 'Weekly open loop',
        dateKey: '2026-04-14',
      }),
      createOpenLoop('open_loop_closed', {
        id: 'open_loop_closed',
        title: 'Weekly resolved loop',
        dateKey: '2026-04-15',
        status: 'closed',
      }),
    ])

    renderApp('/records/activity/review/week?weekKey=2026-W16')
    await settleApp()

    expect(screen.getByText('Weekly open loop')).toBeInTheDocument()
    expect(screen.queryByText('Weekly resolved loop')).not.toBeInTheDocument()
  })

  it.skip('filters search results on the search screen', async () => {
    renderApp('/records/activity/search')
    await settleApp()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search keyword' }), {
      target: { value: '権限設定' },
    })

    expect(screen.getByText('権限設定の確認')).toBeInTheDocument()
    expect(screen.queryByText('Chrome 拡張の調査')).not.toBeInTheDocument()
  })

  it('hides a session from the search view when hide is pressed', async () => {
    renderApp('/records/activity/search')
    await settleApp()

    fireEvent.click(screen.getByRole('button', { name: 'Hide session session_1' }))
    await settleApp()

    expect(api.putActionLogSessionHidden).toHaveBeenCalledWith('session_1', {
      dateKey: '2026-04-17',
      hidden: true,
    })
    expect(screen.queryByTestId('activity-session-session_1')).not.toBeInTheDocument()
  })

  it('prioritizes session summary above the generated title in the day view', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockResolvedValue({
      items: [
        createSession('session_summary_first', {
          title: 'Self Growth App',
          summary: 'Reviewed browser pages for the self-growth app.',
          appNames: ['Chrome'],
        }),
      ],
      nextCursor: null,
    })

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    const card = screen.getByTestId('activity-session-session_summary_first')
    const summary = within(card).getByText('Reviewed browser pages for the self-growth app.')
    const title = within(card).getByText('Self Growth App')

    expect(summary.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('falls back to the title first and shows category-app-domain metadata when summary is missing', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockResolvedValue({
      items: [
        createSession('session_summary_missing', {
          title: 'Fallback Title',
          summary: undefined,
          appNames: ['AppOne'],
          domains: ['domain.example'],
        }),
      ],
      nextCursor: null,
    })

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    const card = screen.getByTestId('activity-session-session_summary_missing')
    const title = within(card).getByText('Fallback Title')
    const metadata = within(card).getByText('学習 / AppOne / domain.example')

    expect(title.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.skip('shows hidden sessions in search only when includeHidden is enabled', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_hidden', {
        title: 'Hidden session',
        hidden: true,
        dateKey: '2026-04-17',
      }),
    ])

    renderApp('/records/activity/search')
    await settleApp()

    expect(screen.queryByText('Hidden session')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Include hidden sessions' }))

    expect(screen.getByText('Hidden session')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore session session_hidden' })).toBeInTheDocument()
  })

  it('filters search results on the search screen with the current strict filters', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_filter', {
        title: 'Extension research',
        summary: 'Investigated extension permissions and manifest settings.',
        searchKeywords: ['extension', 'manifest'],
      }),
    ])
    vi.mocked(api.getActionLogOpenLoops).mockResolvedValue([
      createOpenLoop('open_loop_filter', {
        title: 'Permission checklist',
        description: 'Confirm the remaining permission settings.',
        linkedSessionIds: ['session_filter'],
      }),
    ])

    renderApp('/records/activity/search')
    await settleApp()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search keyword' }), {
      target: { value: 'checklist' },
    })
    await settleApp()

    expect(screen.getByText('Permission checklist')).toBeInTheDocument()
    expect(screen.queryByText('Extension research')).not.toBeInTheDocument()
  })

  it('shows hidden sessions in search only when includeHidden is enabled after the view refreshes', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_hidden', {
        title: 'Hidden session',
        hidden: true,
        dateKey: '2026-04-17',
      }),
    ])

    renderApp('/records/activity/search')
    await settleApp()

    expect(screen.queryByText('Hidden session')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Include hidden sessions' }))
    await settleApp()

    expect(screen.getByText('Hidden session')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore session session_hidden' })).toBeInTheDocument()
  })

  it('uses the same summary-first ordering on the search screen', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_search_order', {
        title: 'Search Result Title',
        summary: 'Summarized search result activity.',
        appNames: ['Chrome'],
      }),
    ])

    renderApp('/records/activity/search')
    await settleApp()

    const card = getSessionCard('session_search_order')
    const summary = within(card).getByText('Summarized search result activity.')
    const title = within(card).getByText('Search Result Title')

    expect(summary.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('allows deleting only up to yesterday on the search screen', async () => {
    vi.setSystemTime(new Date('2026-04-18T09:00:00+09:00'))
    renderApp('/records/activity/search')
    await settleApp()

    const deleteButton = screen.getByRole('button', { name: 'Delete selected action-log range' })
    expect(deleteButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('To date'), {
      target: { value: '2026-04-17' },
    })
    await settleApp()

    expect(deleteButton).not.toBeDisabled()

    fireEvent.click(deleteButton)
    await settleApp()

    expect(api.deleteActionLogRange).toHaveBeenCalledWith('2026-03-20', '2026-04-17')
  })

  it('keeps the manual note placeholder visible', async () => {
    renderApp('/records/activity/day/2026-04-16')
    await settleApp()

    expect(screen.getByText('手動メモ')).toBeInTheDocument()
  })
})
