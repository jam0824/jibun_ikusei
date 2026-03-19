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
  }))
}

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderRecords(initialEntry = '/records') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationDisplay />
      <Routes>
        <Route path="/records" element={<RecordsScreen />} />
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
        <Route path="/records" element={<RecordsScreen />} />
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
    renderRecords('/records')

    expect(
      screen.getByRole('button', { name: '今日のクリア回数を表示' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('朝の読書')).toBeInTheDocument()
    expect(screen.queryByText('夜のランニング')).not.toBeInTheDocument()
    expect(screen.queryByText('週次レビュー')).not.toBeInTheDocument()
  })

  it('uses the filter query to decide which completions to show', () => {
    renderRecords('/records?filter=week')

    expect(
      screen.getByRole('button', { name: '今週のクリア回数を表示' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('朝の読書')).toBeInTheDocument()
    expect(screen.getByText('夜のランニング')).toBeInTheDocument()
    expect(screen.queryByText('週次レビュー')).not.toBeInTheDocument()
  })

  it('updates both the URL and the list when a filter card is tapped', async () => {
    renderRecords('/records?filter=today')

    fireEvent.click(screen.getByRole('button', { name: 'すべてのクリア回数を表示' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records?filter=all')
    expect(
      screen.getByRole('button', { name: 'すべてのクリア回数を表示' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('朝の読書')).toBeInTheDocument()
    expect(screen.getByText('夜のランニング')).toBeInTheDocument()
    expect(screen.getByText('週次レビュー')).toBeInTheDocument()
  })

  it('navigates from home to records with the today filter', async () => {
    renderHomeWithRecords()

    fireEvent.click(screen.getByRole('button', { name: '今日のクリア回数を記録で見る' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records?filter=today')
    expect(
      screen.getByRole('button', { name: '今日のクリア回数を表示' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('朝の読書')).toBeInTheDocument()
    expect(screen.queryByText('夜のランニング')).not.toBeInTheDocument()
  })
})
