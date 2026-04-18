import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { hydratePersistedState } from '@/domain/logic'
import type { PersistedAppState } from '@/domain/types'
import { HomeScreen } from '@/screens/home-screen'
import { useAppStore } from '@/store/app-store'

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

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LocationDisplay />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('home screen records navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-17T09:00:00+09:00'))

    resetStore({
      quests: [
        {
          id: 'quest_daily',
          title: 'Morning stretch',
          description: '',
          questType: 'repeatable',
          isDaily: true,
          xpReward: 3,
          category: 'Health',
          skillMappingMode: 'fixed',
          fixedSkillId: 'skill_habit',
          cooldownMinutes: 0,
          dailyCompletionCap: 7,
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          createdAt: '2026-04-01T09:00:00+09:00',
          updatedAt: '2026-04-01T09:00:00+09:00',
        },
      ],
      completions: [
        {
          id: 'completion_today',
          questId: 'quest_daily',
          clientRequestId: 'req_today',
          completedAt: '2026-04-17T07:30:00+09:00',
          userXpAwarded: 3,
          skillXpAwarded: 3,
          resolvedSkillId: 'skill_habit',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-17T07:30:00+09:00',
        },
      ],
      skills: [
        {
          id: 'skill_habit',
          name: 'Habit',
          normalizedName: 'habit',
          category: 'Health',
          level: 1,
          totalXp: 3,
          source: 'manual',
          status: 'active',
          createdAt: '2026-04-01T09:00:00+09:00',
          updatedAt: '2026-04-01T09:00:00+09:00',
        },
      ],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens today quest records from the daily summary card', () => {
    renderHome()

    fireEvent.click(screen.getByRole('button', { name: '今日のクリア回数を記録で見る' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records/quests?range=today')
  })

  it('opens the records hub from the quick action button', () => {
    renderHome()

    fireEvent.click(screen.getByRole('button', { name: '記録を見る' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/records')
  })
})
