import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { hydratePersistedState } from '@/domain/logic'
import type { PersistedAppState, Quest } from '@/domain/types'
import { QuestListScreen } from '@/screens/quest-list-screen'
import { useAppStore } from '@/store/app-store'

function createQuest(
  id: string,
  title: string,
  overrides: Partial<Quest> & { isDaily?: boolean } = {},
): Quest {
  const now = '2026-04-10T09:00:00+09:00'
  const questType = overrides.questType ?? 'repeatable'

  return {
    id,
    title,
    description: `${title}の説明`,
    questType,
    xpReward: 5,
    category: '学習',
    skillMappingMode: 'ask_each_time',
    cooldownMinutes: questType === 'repeatable' ? 0 : undefined,
    dailyCompletionCap: questType === 'repeatable' ? 10 : undefined,
    status: 'active',
    privacyMode: 'normal',
    pinned: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Quest
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

function renderQuestList(initialEntry = '/quests') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/quests" element={<QuestListScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('quest list daily tabs', () => {
  beforeEach(() => {
    resetStore({
      quests: [
        createQuest('quest_daily', '朝のストレッチ', { isDaily: true }),
        createQuest('quest_repeatable', '夜のランニング'),
        createQuest('quest_one_time', '書類提出', {
          questType: 'one_time',
          cooldownMinutes: undefined,
          dailyCompletionCap: undefined,
        }),
        createQuest('quest_browsing_daily', '閲覧デイリー', {
          isDaily: true,
          source: 'browsing',
        }),
      ],
    })
  })

  it('shows tabs in the daily-first order', () => {
    renderQuestList()

    const labels = ['デイリー', '繰り返し', '単発', 'すべて', '完了済み', 'アーカイブ']
    const tabButtons = screen
      .getAllByRole('button')
      .filter((button) => labels.includes(button.textContent?.trim() ?? ''))

    expect(tabButtons.map((button) => button.textContent?.trim())).toEqual(labels)
  })

  it('shows only daily repeatable quests in the daily tab and non-daily ones in repeatable', () => {
    renderQuestList()

    expect(screen.getByText('朝のストレッチ')).toBeInTheDocument()
    expect(screen.queryByText('夜のランニング')).not.toBeInTheDocument()
    expect(screen.queryByText('書類提出')).not.toBeInTheDocument()
    expect(screen.queryByText('閲覧デイリー')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '繰り返し' }))

    expect(screen.queryByText('朝のストレッチ')).not.toBeInTheDocument()
    expect(screen.getByText('夜のランニング')).toBeInTheDocument()
    expect(screen.queryByText('書類提出')).not.toBeInTheDocument()
    expect(screen.queryByText('閲覧デイリー')).not.toBeInTheDocument()
  })
})
