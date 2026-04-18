import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { hydratePersistedState } from '@/domain/logic'
import type { PersistedAppState, Quest } from '@/domain/types'
import { QuestFormScreen } from '@/screens/quest-form-screen'
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

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderQuestForm(initialEntry = '/quests/new') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationDisplay />
      <Routes>
        <Route path="/quests/new" element={<QuestFormScreen />} />
        <Route path="/quests" element={<div>quest list</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('quest form daily setting', () => {
  beforeEach(() => {
    resetStore({})
  })

  it('does not render the old meal-register tab switcher on the quest form', () => {
    renderQuestForm()

    expect(screen.queryByRole('button', { name: '食事登録' })).not.toBeInTheDocument()
  })

  it('shows the daily setting only for repeatable quests', () => {
    renderQuestForm()

    expect(screen.getByRole('switch', { name: 'デイリー' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /単発クエスト/ }))

    expect(screen.queryByRole('switch', { name: 'デイリー' })).not.toBeInTheDocument()
  })

  it('persists daily quests and reflects the setting when editing', () => {
    const view = renderQuestForm()

    fireEvent.change(screen.getByPlaceholderText('クエスト名'), {
      target: { value: '朝の読書' },
    })
    fireEvent.click(screen.getByRole('switch', { name: 'デイリー' }))
    fireEvent.click(screen.getByRole('button', { name: 'クエストを保存' }))

    const savedQuest = useAppStore.getState().quests.find((quest) => quest.title === '朝の読書') as
      | (Quest & { isDaily?: boolean })
      | undefined

    expect(savedQuest?.isDaily).toBe(true)
    expect(screen.getByTestId('location')).toHaveTextContent('/quests')

    view.unmount()
    renderQuestForm(`/quests/new?edit=${savedQuest?.id}`)

    expect(screen.getByRole('switch', { name: 'デイリー' })).toHaveAttribute('aria-checked', 'true')
  })

  it('clears the daily setting when a quest is switched to one-time', () => {
    const quest = createQuest('quest_daily_edit', '毎日の片付け', { isDaily: true })
    resetStore({ quests: [quest] })

    renderQuestForm('/quests/new?edit=quest_daily_edit')

    expect(screen.getByRole('switch', { name: 'デイリー' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: /単発クエスト/ }))
    fireEvent.click(screen.getByRole('button', { name: '更新する' }))

    const updatedQuest = useAppStore.getState().quests.find((entry) => entry.id === quest.id) as
      | (Quest & { isDaily?: boolean })
      | undefined

    expect(updatedQuest?.questType).toBe('one_time')
    expect(updatedQuest?.isDaily).toBeUndefined()
  })
})
