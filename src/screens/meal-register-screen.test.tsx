import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { hydratePersistedState } from '@/domain/logic'
import type { PersistedAppState } from '@/domain/types'
import { MealRegisterScreen } from '@/screens/meal-register-screen'
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
    fetchNutrition: vi.fn().mockResolvedValue({
      daily: null,
      breakfast: null,
      lunch: null,
      dinner: null,
    }),
  }))
}

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderMealRegister() {
  return render(
    <MemoryRouter initialEntries={['/meal']}>
      <LocationDisplay />
      <Routes>
        <Route path="/meal" element={<MealRegisterScreen />} />
        <Route path="/meal/analyze" element={<div>meal analyze route</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('meal register screen', () => {
  beforeEach(() => {
    resetStore({})
  })

  it('does not render the old quest-add tab switcher', () => {
    renderMealRegister()

    expect(screen.queryByRole('button', { name: 'クエスト追加' })).not.toBeInTheDocument()
    expect(screen.getByText('登録区分')).toBeInTheDocument()
  })

  it('navigates to analysis with the selected meal type and JST date', () => {
    renderMealRegister()

    fireEvent.click(screen.getByRole('button', { name: /朝/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('/meal/analyze?type=breakfast&date=')
  })
})
