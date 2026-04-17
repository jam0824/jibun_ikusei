import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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
import { useAppStore } from '@/store/app-store'

const LAST_RECORDS_ROUTE_KEY = 'app.records.lastRoute'

function createQuest(id: string, title: string): Quest {
  const now = '2026-04-17T09:00:00+09:00'
  return {
    id,
    title,
    description: `${title}のメモ`,
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
    title: 'Chrome拡張の調査',
    primaryCategory: '学習',
    activityKinds: ['調査'],
    appNames: ['Chrome'],
    domains: ['developer.chrome.com'],
    projectNames: [],
    summary: 'Chrome 拡張まわりの調査をまとめていた。',
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
    summary: 'リリィは、午前中に Chrome 拡張まわりの調査をじっくり進めていた様子を見ていた。',
    mainThemes: ['Chrome拡張', '調査'],
    noteIds: [],
    openLoopIds: ['open_loop_1'],
    reviewQuestions: ['次に試すパターンは固まっている？'],
    generatedAt: `${dateKey}T22:00:00+09:00`,
    ...overrides,
  }
}

function createWeeklyReview(weekKey = '2026-W16', overrides: Partial<WeeklyActivityReview> = {}): WeeklyActivityReview {
  return {
    id: `weekly_${weekKey}`,
    weekKey,
    summary: 'リリィは、この週に調査と整理の時間が増えていたことに気づいている。',
    categoryDurations: {
      学習: 180,
      仕事: 120,
    },
    focusThemes: ['Chrome拡張', '行動ログ'],
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
    title: '認証エラーの調査',
    description: 'manifest の設定差分を次に試す。',
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
      quests: [createQuest('quest_today', '朝の読書')],
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
        title: '前日の実装整理',
        primaryCategory: '仕事',
        activityKinds: ['実装'],
        appNames: ['Code'],
        domains: [],
        searchKeywords: ['前日', '実装'],
        openLoopIds: [],
      }),
    ])
    vi.spyOn(api, 'getActionLogDailyActivityLog').mockResolvedValue(createDailyLog())
    vi.spyOn(api, 'getActionLogDailyActivityLogs').mockResolvedValue([
      createDailyLog('2026-04-03', { summary: '前月の記録。', mainThemes: ['前月'] }),
      createDailyLog('2026-04-17'),
    ])
    vi.spyOn(api, 'getActionLogWeeklyActivityReview').mockResolvedValue(createWeeklyReview())
    vi.spyOn(api, 'getActionLogWeeklyActivityReviews').mockResolvedValue([
      createWeeklyReview('2026-W15', { summary: '前週のまとめ。', focusThemes: ['前週'] }),
      createWeeklyReview('2026-W16'),
    ])
    vi.spyOn(api, 'getActionLogOpenLoops').mockResolvedValue([
      createOpenLoop(),
      createOpenLoop('open_loop_2', {
        title: '検索対象の open loop',
        dateKey: '2026-04-16',
        linkedSessionIds: ['session_2'],
      }),
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('redirects /records to the default quests route when no previous child route exists', async () => {
    renderApp('/records')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/quests?range=today')
    expect(screen.getByRole('button', { name: '今日のクリア回数を表示' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('restores the previously viewed child route from localStorage', async () => {
    window.localStorage.setItem(LAST_RECORDS_ROUTE_KEY, '/records/activity/search')

    renderApp('/records')
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/search')
    expect(screen.getByRole('heading', { name: '行動ログ検索' })).toBeInTheDocument()
  })

  it('renders the quests route at /records/quests', () => {
    renderApp('/records/quests?range=week')

    expect(screen.getByRole('button', { name: '今週のクリア回数を表示' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('朝の読書').length).toBeGreaterThan(0)
  })

  it('renders the today activity screen with DailyActivityLog before the timeline', async () => {
    renderApp('/records/activity/today')
    await settleApp()

    expect(screen.getByRole('heading', { name: '今日の行動ログ' })).toBeInTheDocument()
    expect(screen.getByText('その日のまとめ')).toBeInTheDocument()
    expect(screen.getByText('Chrome拡張の調査')).toBeInTheDocument()
    expect(screen.queryByText('Mock')).not.toBeInTheDocument()
  })

  it('switches to raw event display when view=event is specified', async () => {
    renderApp('/records/activity/today?view=event')
    await settleApp()

    expect(screen.getByText('表示モード: event')).toBeInTheDocument()
    expect(screen.getAllByText('Chrome / Manifest V3 - Chrome for Developers').length).toBeGreaterThan(0)
  })

  it('renders the requested month and navigates from calendar to day detail', async () => {
    renderApp('/records/activity/calendar?month=2026-04')
    await settleApp()

    expect(screen.getByText('対象月: 2026-04')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '2026-04-03 の行動ログを見る' }))
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/day/2026-04-03')
  })

  it('defaults calendar month to the current JST month and updates month query from controls', async () => {
    renderApp('/records/activity/calendar')
    await settleApp()

    expect(screen.getByText('対象月: 2026-04')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '前月' }))
    await settleApp()
    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/calendar?month=2026-03')

    fireEvent.click(screen.getByRole('button', { name: '次月' }))
    await settleApp()
    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/calendar?month=2026-04')

    fireEvent.change(screen.getByLabelText('対象月ピッカー'), {
      target: { value: '2026-02' },
    })
    await settleApp()
    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/calendar?month=2026-02')
  })

  it('renders the requested review year and navigates to weekly detail', async () => {
    renderApp('/records/activity/review/year?year=2026')
    await settleApp()

    expect(screen.getByText('対象年: 2026')).toBeInTheDocument()
    expect(screen.getByText('前週のまとめ。')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '詳細を見る' })[0])
    await settleApp()

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/review/week?weekKey=2026-W15')
  })

  it('defaults review year to the current JST year and updates year query from controls', async () => {
    renderApp('/records/activity/review/year')
    await settleApp()

    expect(screen.getByText('対象年: 2026')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '前年' }))
    await settleApp()
    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/review/year?year=2025')

    fireEvent.click(screen.getByRole('button', { name: '次年' }))
    await settleApp()
    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/review/year?year=2026')

    fireEvent.change(screen.getByLabelText('対象年ピッカー'), {
      target: { value: '2024' },
    })
    await settleApp()
    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/review/year?year=2024')
  })

  it('renders the requested weekly review detail', async () => {
    renderApp('/records/activity/review/week?weekKey=2026-W16')
    await settleApp()

    expect(screen.getByText('週キー: 2026-W16')).toBeInTheDocument()
    expect(screen.getByText('Chrome拡張')).toBeInTheDocument()
  })

  it('filters sessions and open loops on the search screen', async () => {
    renderApp('/records/activity/search')
    await settleApp()

    expect(screen.getByRole('heading', { name: '行動ログ検索' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('キーワードで検索'), {
      target: { value: 'open loop' },
    })

    expect(screen.getByText('検索対象の open loop')).toBeInTheDocument()
    expect(screen.queryByText('Chrome拡張の調査')).not.toBeInTheDocument()
  })

  it('shows the manual note placeholder on the activity day view', async () => {
    renderApp('/records/activity/today')
    await settleApp()

    expect(screen.getByText('手動メモ')).toBeInTheDocument()
    expect(screen.getByText('手動メモの追加と保存は後続フェーズで実装します。Phase 6 では表示枠だけを用意しています。')).toBeInTheDocument()
  })
})
