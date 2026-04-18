import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { hydratePersistedState } from '@/domain/logic'
import type { PersistedAppState, Quest, QuestCompletion } from '@/domain/types'
import { HomeScreen } from '@/screens/home-screen'
import { RecordsScreen } from '@/screens/records-screen'
import { useAppStore } from '@/store/app-store'

function createQuest(id: string, title: string): Quest {
  const now = '2026-03-19T09:00:00+09:00'
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

function createCompletion(
  id: string,
  questId: string,
  completedAt: string,
  undoneAt?: string,
): QuestCompletion {
  return {
    id,
    questId,
    clientRequestId: `req_${id}`,
    completedAt,
    userXpAwarded: 5,
    skillResolutionStatus: 'resolved',
    undoneAt,
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

function renderRecords(initialEntry = '/records/growth') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationDisplay />
      <Routes>
        <Route path="/records/growth" element={<RecordsScreen />} />
        <Route path="/records/review/weekly" element={<div>weekly reflection route</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderHomeWithRecords() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LocationDisplay />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/records" element={<div>records hub route</div>} />
        <Route path="/records/growth" element={<RecordsScreen />} />
        <Route path="/records/review/weekly" element={<div>weekly reflection route</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('records screen filters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-19T12:00:00+09:00'))

    resetStore({
      quests: [
        createQuest('quest_today', '朝の読書'),
        createQuest('quest_week', '夜のランニング'),
        createQuest('quest_old', '週次レビュー'),
      ],
      completions: [
        createCompletion('completion_today', 'quest_today', '2026-03-19T08:30:00+09:00'),
        createCompletion('completion_week', 'quest_week', '2026-03-16T20:00:00+09:00'),
        createCompletion('completion_old', 'quest_old', '2026-03-12T21:00:00+09:00'),
        createCompletion(
          'completion_undone',
          'quest_today',
          '2026-03-19T09:30:00+09:00',
          '2026-03-19T09:35:00+09:00',
        ),
      ],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('defaults to the today filter when opened without a filter query', () => {
    renderRecords('/records/growth')

    expect(
      screen.getByRole('button', { name: '今日のクリア回数を表示' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('朝の読書')).toBeInTheDocument()
    expect(screen.queryByText('夜のランニング')).not.toBeInTheDocument()
    expect(screen.queryByText('週次レビュー')).not.toBeInTheDocument()
  })

  it('uses the filter query to decide which completions to show', () => {
    renderRecords('/records/growth?range=week')

    expect(
      screen.getByRole('button', { name: '今週のクリア回数を表示' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('朝の読書').length).toBeGreaterThan(0)
    expect(screen.getAllByText('夜のランニング').length).toBeGreaterThan(0)
    expect(screen.queryByText('週次レビュー')).not.toBeInTheDocument()
  })

  it('updates both the URL and the list when a filter card is tapped', async () => {
    renderRecords('/records/growth?range=today')

    fireEvent.click(screen.getByRole('button', { name: 'すべてのクリア回数を表示' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records/growth?range=all')
    expect(
      screen.getByRole('button', { name: 'すべてのクリア回数を表示' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('朝の読書').length).toBeGreaterThan(0)
    expect(screen.getAllByText('夜のランニング').length).toBeGreaterThan(0)
    expect(screen.getAllByText('週次レビュー').length).toBeGreaterThan(0)
  })

  it('navigates from home to records with the today filter', async () => {
    renderHomeWithRecords()

    fireEvent.click(screen.getByRole('button', { name: '今日のクリア回数を記録で見る' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records/growth?range=today')
    expect(
      screen.getByRole('button', { name: '今日のクリア回数を表示' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('朝の読書')).toBeInTheDocument()
    expect(screen.queryByText('夜のランニング')).not.toBeInTheDocument()
  })

  it('shows weekly quest rankings with previous-week comparisons while keeping the detail list', () => {
    resetStore({
      quests: [
        createQuest('quest_reading', '朝の読書'),
        createQuest('quest_run', '夜のランニング'),
        createQuest('quest_review', '週次レビュー'),
      ],
      completions: [
        createCompletion('reading_week_1', 'quest_reading', '2026-03-19T08:30:00+09:00'),
        createCompletion('reading_week_2', 'quest_reading', '2026-03-17T07:30:00+09:00'),
        createCompletion('reading_prev_1', 'quest_reading', '2026-03-10T08:30:00+09:00'),
        createCompletion('run_week_1', 'quest_run', '2026-03-18T20:00:00+09:00'),
        createCompletion('run_prev_1', 'quest_run', '2026-03-12T20:00:00+09:00'),
        createCompletion('run_prev_2', 'quest_run', '2026-03-11T20:00:00+09:00'),
        createCompletion('review_prev_1', 'quest_review', '2026-03-13T21:00:00+09:00'),
      ],
    })

    renderRecords('/records/growth?range=week')

    expect(screen.getByText('今週のクリア回数上位10位')).toBeInTheDocument()
    expect(screen.getByText('今週 2回')).toBeInTheDocument()
    expect(screen.getByText('先週 1回')).toBeInTheDocument()
    expect(screen.getByText('今週 1回')).toBeInTheDocument()
    expect(screen.getByText('先週 2回')).toBeInTheDocument()
    expect(screen.getAllByText('朝の読書')).toHaveLength(3)
    expect(screen.queryByText('週次レビュー')).not.toBeInTheDocument()
  })

  it('shows all-time quest rankings as cumulative counts', () => {
    resetStore({
      quests: [
        createQuest('quest_reading', '朝の読書'),
        createQuest('quest_run', '夜のランニング'),
      ],
      completions: [
        createCompletion('reading_1', 'quest_reading', '2026-03-19T08:30:00+09:00'),
        createCompletion('reading_2', 'quest_reading', '2026-03-17T07:30:00+09:00'),
        createCompletion('reading_3', 'quest_reading', '2026-03-10T08:30:00+09:00'),
        createCompletion('run_1', 'quest_run', '2026-03-18T20:00:00+09:00'),
      ],
    })

    renderRecords('/records/growth?range=all')

    expect(screen.getByText('累計クリア回数上位10位')).toBeInTheDocument()
    expect(screen.getByText('累計 3回')).toBeInTheDocument()
    expect(screen.getByText('累計 1回')).toBeInTheDocument()
  })

  it('does not show quest rankings for the today filter', () => {
    renderRecords('/records/growth?range=today')

    expect(screen.queryByText('今週のクリア回数上位10位')).not.toBeInTheDocument()
    expect(screen.queryByText('累計クリア回数上位10位')).not.toBeInTheDocument()
  })
})

describe('weekly reflection navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-24T12:00:00+09:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows an unread weekly reflection card on home and navigates to it', () => {
    resetStore({
      quests: [createQuest('quest_reflection', 'Read 30 minutes')],
      completions: [
        createCompletion(
          'completion_reflection',
          'quest_reflection',
          '2026-03-17T08:30:00+09:00',
        ),
      ],
    })

    renderHomeWithRecords()

    fireEvent.click(screen.getByRole('button', { name: '先週のふりかえりを確認' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records/review/weekly')
  })

  it('shows the weekly reflection link from quest records in week view', () => {
    resetStore({
      quests: [createQuest('quest_reflection', 'Read 30 minutes')],
      completions: [
        createCompletion(
          'completion_reflection',
          'quest_reflection',
          '2026-03-17T08:30:00+09:00',
        ),
      ],
    })

    renderRecords('/records/growth?range=week')

    fireEvent.click(screen.getByRole('button', { name: '先週のふりかえりを確認' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records/review/weekly')
  })
})

describe('records screen growth-only layout', () => {
  beforeEach(() => {
    resetStore({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render the old local tabs for browsing, nutrition, and health', () => {
    renderRecords('/records/growth')

    expect(screen.queryByRole('button', { name: '閲覧' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '栄養' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '健康' })).not.toBeInTheDocument()
  })
})
