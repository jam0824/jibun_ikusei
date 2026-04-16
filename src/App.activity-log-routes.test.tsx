import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppShellRoutes } from '@/App'
import { hydratePersistedState } from '@/domain/logic'
import { getWeekKey } from '@/lib/date'
import type { PersistedAppState, Quest, QuestCompletion } from '@/domain/types'
import { useAppStore } from '@/store/app-store'

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

describe('activity log mock routes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-17T09:00:00+09:00'))

    resetStore({
      quests: [createQuest('quest_today', '朝の読書')],
      completions: [createCompletion('completion_today', 'quest_today', '2026-04-17T08:30:00+09:00')],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the today mock screen at /records/activity/today', () => {
    renderApp('/records/activity/today')

    expect(screen.getByRole('heading', { name: '今日の行動ログ' })).toBeInTheDocument()
    expect(screen.getByText('Mock')).toBeInTheDocument()
  })

  it('renders the requested day mock screen at /records/activity/day/:dateKey', () => {
    renderApp('/records/activity/day/2026-04-17')

    expect(screen.getByRole('heading', { name: '日別の行動ログ' })).toBeInTheDocument()
    expect(screen.getByText('対象日: 2026-04-17')).toBeInTheDocument()
  })

  it('renders the search mock screen at /records/activity/search', () => {
    renderApp('/records/activity/search')

    expect(screen.getByRole('heading', { name: '行動ログ検索' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('キーワードで検索')).toBeInTheDocument()
  })

  it('renders the year review mock screen at /records/activity/review/year', () => {
    renderApp('/records/activity/review/year')

    expect(screen.getByRole('heading', { name: '週次行動レビュー一覧' })).toBeInTheDocument()
    expect(screen.getByText('対象年: 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '前年' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次年' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '詳細を見る' }).length).toBeGreaterThan(0)
  })

  it('renders the weekly review detail mock screen at /records/activity/review/week', () => {
    renderApp('/records/activity/review/week')

    expect(screen.getByRole('heading', { name: '週次行動レビュー詳細' })).toBeInTheDocument()
    expect(screen.getByText(`週キー: ${getWeekKey(new Date())}`)).toBeInTheDocument()
  })

  it('switches the label for today route when view=event', () => {
    renderApp('/records/activity/today?view=event')

    expect(screen.getByText('表示単位: event')).toBeInTheDocument()
  })

  it('switches the label for day route when view=session', () => {
    renderApp('/records/activity/day/2026-04-17?view=session')

    expect(screen.getByText('表示単位: session')).toBeInTheDocument()
  })

  it('shows the daily summary before the timeline on the day route', () => {
    renderApp('/records/activity/day/2026-04-17?view=session')

    const dailySummaryHeading = screen.getByText('その日のまとめ')
    const timelineLabel = screen.getByText('Timeline')

    expect(dailySummaryHeading.compareDocumentPosition(timelineLabel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('shows the requested month on the calendar route when month is provided', () => {
    renderApp('/records/activity/calendar?month=2026-03')

    expect(screen.getByText('対象月: 2026-03')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '前月' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次月' })).toBeInTheDocument()
  })

  it('navigates to the day route when a calendar day card is pressed', () => {
    renderApp('/records/activity/calendar?month=2026-03')

    fireEvent.click(screen.getByRole('button', { name: '2026-03-03 の行動ログを見る' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records/activity/day/2026-03-03')
    expect(screen.getByRole('heading', { name: '日別の行動ログ' })).toBeInTheDocument()
  })

  it('keeps the existing /records screen working', () => {
    renderApp('/records')

    expect(screen.getByRole('button', { name: '今日のクリア回数を表示' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('朝の読書')).toBeInTheDocument()
  })
})
