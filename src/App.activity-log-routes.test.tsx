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

const LAST_RECORDS_ROUTE_KEY = 'app.records.lastRoute'

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
    await vi.runAllTimersAsync()
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
      },
      deletionRequestId: 'delete_1',
    })
    vi.spyOn(api, 'getActionLogOpenLoops').mockResolvedValue([
      createOpenLoop(),
      createOpenLoop('open_loop_2', {
        title: '検索画面の open loop',
        dateKey: '2026-04-16',
        linkedSessionIds: ['session_2'],
      }),
    ])

    vi.spyOn(ai, 'generateDailyActivityLog').mockResolvedValue({
      provider: 'template',
      summary: 'リリィは、前日の調査の流れを静かに見つめていた。',
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

  it('redirects /records to the default quests route when no previous child route exists', async () => {
    renderApp('/records')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/quests?range=today')
  })

  it('restores the previously viewed child route from localStorage', async () => {
    window.localStorage.setItem(LAST_RECORDS_ROUTE_KEY, '/records/activity/search')

    renderApp('/records')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/search')
  })

  it('renders the quests route at /records/quests', () => {
    renderApp('/records/quests?range=week')
    expect(screen.getAllByText('今日の読書').length).toBeGreaterThan(0)
  })

  it('renders the today activity screen without generating a missing daily log', async () => {
    vi.mocked(api.getActionLogDailyActivityLog).mockResolvedValueOnce(null)

    renderApp('/records/activity/today')
    await settleApp()

    expect(screen.getByText('対象日: 2026-04-17')).toBeInTheDocument()
    expect(screen.getByText('その日のまとめ')).toBeInTheDocument()
    expect(api.putActionLogDailyActivityLog).not.toHaveBeenCalled()
  })

  it('switches to raw event display when view=event is specified', async () => {
    renderApp('/records/activity/today?view=event')
    await settleApp()

    expect(screen.getByText('イベント表示')).toBeInTheDocument()
    expect(screen.getAllByText('Chrome / Manifest V3 - Chrome for Developers').length).toBeGreaterThan(0)
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
    vi.mocked(api.getActionLogSessions).mockResolvedValue(createCompactableSessionBurst())

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(2)
    expect(screen.getByText('YouTubeで動画を視聴')).toBeInTheDocument()
    expect(screen.getByText('Codexでコード作業')).toBeInTheDocument()
    expect(screen.getAllByText('3件')).toHaveLength(2)
    expect(screen.getByText('表示中: 2 / 2件')).toBeInTheDocument()
  })

  it('does not render hide buttons on today session cards', async () => {
    renderApp('/records/activity/today')
    await settleApp()

    expect(screen.queryByRole('button', { name: 'Hide session session_1' })).not.toBeInTheDocument()
  })

  it('shows only the first 50 sessions until more is requested', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue(createSessionBatch(75))

    renderApp('/records/activity/today')
    await settleApp()

    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(50)
    expect(screen.getByText('表示中: 50 / 75件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'さらに50件表示' })).toBeInTheDocument()
    expect(screen.queryByTestId('activity-session-session_051')).not.toBeInTheDocument()
  })

  it('shows the next 50 sessions after pressing load more', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue(createSessionBatch(120))

    renderApp('/records/activity/today')
    await settleApp()

    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))

    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(100)
    expect(screen.getByText('表示中: 100 / 120件')).toBeInTheDocument()
    expect(screen.getByTestId('activity-session-session_051')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'さらに50件表示' })).toBeInTheDocument()
  })

  it('keeps session and event pagination state separate and resets when the view changes', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue(createSessionBatch(120))
    vi.mocked(api.getActionLogRawEvents).mockResolvedValue(createRawEventBatch(70))

    renderApp('/records/activity/today')
    await settleApp()

    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(100)

    fireEvent.click(screen.getByRole('button', { name: 'event' }))
    await settleApp()

    expect(screen.getAllByTestId(/activity-event-/)).toHaveLength(50)
    expect(screen.getByText('表示中: 50 / 70件')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-event-event_051')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'session' }))
    await settleApp()

    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(50)
    expect(screen.getByText('表示中: 50 / 120件')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-session-session_051')).not.toBeInTheDocument()
  })

  it('resets the session pagination when hidden sessions are included', async () => {
    const sessions = [
      ...createSessionBatch(70),
      ...createSessionBatch(10, { startIndex: 70, overrides: { hidden: true } }).map((session, index) => ({
        ...session,
        id: `hidden_session_${String(index + 1).padStart(3, '0')}`,
        title: `Hidden Session ${String(index + 1).padStart(3, '0')}`,
        searchKeywords: [`hidden_session_${index + 1}`],
      })),
    ]
    vi.mocked(api.getActionLogSessions).mockResolvedValue(sessions)

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(70)
    expect(screen.getByText('表示中: 70 / 70件')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Include hidden sessions in timeline' }))
    await settleApp()

    expect(screen.getAllByTestId(/activity-session-/)).toHaveLength(50)
    expect(screen.getByText('表示中: 50 / 80件')).toBeInTheDocument()
    expect(screen.queryByText('Hidden Session 001')).not.toBeInTheDocument()
  })

  it('shows newer sessions above older ones on the today timeline', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_old', {
        startedAt: '2026-04-17T09:00:00+09:00',
        endedAt: '2026-04-17T09:20:00+09:00',
        title: 'Older session',
        summary: 'Older session summary.',
      }),
      createSession('session_new', {
        startedAt: '2026-04-17T11:00:00+09:00',
        endedAt: '2026-04-17T11:20:00+09:00',
        title: 'Newer session',
        summary: 'Newer session summary.',
      }),
    ])

    renderApp('/records/activity/today')
    await settleApp()

    const newerCard = getSessionCard('session_new')
    const olderCard = getSessionCard('session_old')

    expect(newerCard.compareDocumentPosition(olderCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows newer raw events above older ones on the day event timeline', async () => {
    vi.mocked(api.getActionLogRawEvents).mockResolvedValue([
      createRawEvent('event_old', {
        occurredAt: '2026-04-17T09:05:00+09:00',
        windowTitle: 'Older event title',
      }),
      createRawEvent('event_new', {
        occurredAt: '2026-04-17T11:05:00+09:00',
        windowTitle: 'Newer event title',
      }),
    ])

    renderApp('/records/activity/day/2026-04-17?view=event')
    await settleApp()

    const newerTitle = screen.getByText('Chrome / Newer event title')
    const olderTitle = screen.getByText('Chrome / Older event title')

    expect(newerTitle.compareDocumentPosition(olderTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not render restore buttons on day session cards even when hidden sessions are included', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_hidden_day', {
        id: 'session_hidden_day',
        hidden: true,
      }),
    ])

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

  it('does not show closed open loops on the day view', async () => {
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

    expect(screen.getByText('Still open loop')).toBeInTheDocument()
    expect(screen.queryByText('Resolved loop')).not.toBeInTheDocument()
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
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_summary_first', {
        title: 'Self Growth App',
        summary: 'Reviewed browser pages for the self-growth app.',
        appNames: ['Chrome'],
      }),
    ])

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    const card = getSessionCard('session_summary_first')
    const summary = within(card).getByText('Reviewed browser pages for the self-growth app.')
    const title = within(card).getByText('Self Growth App')

    expect(summary.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('falls back to the title first and shows category-app-domain metadata when summary is missing', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_summary_missing', {
        title: 'Fallback Title',
        summary: undefined,
        appNames: ['AppOne'],
        domains: ['domain.example'],
      }),
    ])

    renderApp('/records/activity/day/2026-04-17')
    await settleApp()

    const card = getSessionCard('session_summary_missing')
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
