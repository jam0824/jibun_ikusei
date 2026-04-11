import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { hydratePersistedState } from '@/domain/logic'
import type { PersistedAppState } from '@/domain/types'
import { WeeklyReflectionScreen } from '@/screens/weekly-reflection-screen'
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

function renderWeeklyReflection() {
  return render(
    <MemoryRouter initialEntries={['/weekly-reflection']}>
      <Routes>
        <Route path="/weekly-reflection" element={<WeeklyReflectionScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('weekly reflection screen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-14T12:00:00+09:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the previous-week summary, comment, and recommendations', async () => {
    const ensureWeeklyReflection = vi.fn().mockResolvedValue({ hasData: true, weekKey: '2026-W15' })
    const playAssistantMessage = vi.fn().mockResolvedValue(undefined)

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
      skills: [
        {
          id: 'skill_habit',
          name: 'Habit',
          normalizedName: 'habit',
          category: 'Health',
          level: 1,
          totalXp: 0,
          source: 'manual',
          status: 'active',
          createdAt: '2026-04-01T09:00:00+09:00',
          updatedAt: '2026-04-01T09:00:00+09:00',
        },
      ],
      completions: [
        {
          id: 'completion_monday',
          questId: 'quest_daily',
          clientRequestId: 'req_monday',
          completedAt: '2026-04-06T08:00:00+09:00',
          userXpAwarded: 3,
          skillXpAwarded: 3,
          resolvedSkillId: 'skill_habit',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-06T08:00:00+09:00',
        },
        {
          id: 'completion_wednesday',
          questId: 'quest_daily',
          clientRequestId: 'req_wednesday',
          completedAt: '2026-04-08T08:00:00+09:00',
          userXpAwarded: 3,
          skillXpAwarded: 3,
          resolvedSkillId: 'skill_habit',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-08T08:00:00+09:00',
        },
      ],
      assistantMessages: [
        {
          id: 'msg_weekly_reflection',
          triggerType: 'weekly_reflection',
          mood: 'calm',
          text: 'Good rhythm this week.',
          periodKey: '2026-W15',
          createdAt: '2026-04-14T12:00:00+09:00',
        },
      ],
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
        latestWeeklyReflection: {
          weekKey: '2026-W15',
          comment: 'Good rhythm this week.',
          recommendations: ['Keep the same morning cue.', 'Add one lighter recovery task.'],
          generatedAt: '2026-04-14T12:00:00+09:00',
          provider: 'template',
        },
      },
    })

    useAppStore.setState((state) => ({
      ...state,
      ensureWeeklyReflection,
      playAssistantMessage,
    }))

    renderWeeklyReflection()
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(screen.getByText('2026-04-06 〜 2026-04-12')).toBeInTheDocument()
    expect(screen.getByText('Good rhythm this week.')).toBeInTheDocument()
    expect(screen.getByText('Keep the same morning cue.')).toBeInTheDocument()
    expect(screen.getByText('Add one lighter recovery task.')).toBeInTheDocument()
    expect(screen.getByText('先週いちばん伸びたスキル')).toBeInTheDocument()
    expect(screen.getByText('先週の主役クエスト')).toBeInTheDocument()
    expect(screen.getByText('先週伸びたスキル')).toBeInTheDocument()
    expect(screen.getByText('先週 2日 / 先々週 0日')).toBeInTheDocument()
    expect(screen.getByText('先週 2回 / 先々週 0回')).toBeInTheDocument()
    expect(screen.getAllByText('Morning stretch').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Lilyコメントを再生' }))

    expect(playAssistantMessage).toHaveBeenCalledWith('msg_weekly_reflection')
  })

  it('shows the fixed empty state when the previous week has no quest data', async () => {
    const ensureWeeklyReflection = vi.fn().mockResolvedValue({ hasData: false, weekKey: '2026-W15' })

    resetStore({})
    useAppStore.setState((state) => ({
      ...state,
      ensureWeeklyReflection,
    }))

    renderWeeklyReflection()
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(screen.getByText('先週はクエスト記録がありませんでした。来週は小さな 1 件から始めましょう。')).toBeInTheDocument()
  })
})
