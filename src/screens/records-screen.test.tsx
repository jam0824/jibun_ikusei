import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { hydratePersistedState } from '@/domain/logic'
import type {
  NutrientEntry,
  NutrientMap,
  NutritionRecord,
  PersistedAppState,
  Quest,
  QuestCompletion,
} from '@/domain/types'
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

function createNutritionEntry(value: number | null, unit = 'g'): NutrientEntry {
  return {
    value,
    unit,
    label: null,
    threshold: null,
  }
}

function createNutritionMap(value: number | null = null): NutrientMap {
  return {
    energy: createNutritionEntry(value, 'kcal'),
    protein: createNutritionEntry(value),
    fat: createNutritionEntry(value),
    carbs: createNutritionEntry(value),
    potassium: createNutritionEntry(value, 'mg'),
    calcium: createNutritionEntry(value, 'mg'),
    iron: createNutritionEntry(value, 'mg'),
    vitaminA: createNutritionEntry(value, 'µg'),
    vitaminE: createNutritionEntry(value, 'mg'),
    vitaminB1: createNutritionEntry(value, 'mg'),
    vitaminB2: createNutritionEntry(value, 'mg'),
    vitaminB6: createNutritionEntry(value, 'mg'),
    vitaminC: createNutritionEntry(value, 'mg'),
    fiber: createNutritionEntry(value),
    saturatedFat: createNutritionEntry(value),
    salt: createNutritionEntry(value),
  }
}

function createNutritionRecord(
  mealType: NutritionRecord['mealType'],
  proteinValue: number,
  updatedAt: string,
  date = '2026-03-19',
  createdAt = updatedAt,
  nutrientOverrides: Partial<NutrientMap> = {},
): NutritionRecord {
  return {
    userId: 'user_1',
    date,
    mealType,
    nutrients: {
      ...createNutritionMap(null),
      protein: createNutritionEntry(proteinValue),
      ...nutrientOverrides,
    },
    createdAt,
    updatedAt,
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

describe('records screen nutrition view', () => {
  beforeEach(() => {
    resetStore({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1日分がない場合は最新登録データを表示する', async () => {
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const dayData = {
      daily: null,
      breakfast: createNutritionRecord('breakfast', 10.1, `${date}T08:00:00+09:00`, date),
      lunch: createNutritionRecord(
        'lunch',
        20.2,
        `${date}T12:30:00+09:00`,
        date,
        `${date}T12:30:00+09:00`,
        {
          protein: {
            value: 20.2,
            unit: 'g',
            label: '適正',
            threshold: { type: 'range', lower: 18, upper: 30 },
          },
          potassium: {
            value: 1200,
            unit: 'mg',
            label: '不足',
            threshold: { type: 'min_only', lower: 3000 },
          },
          salt: {
            value: 7.9,
            unit: 'g',
            label: '過剰',
            threshold: { type: 'max_only', upper: 7.5 },
          },
          fiber: {
            value: 11.5,
            unit: 'g',
            label: null,
            threshold: null,
          },
        },
      ),
      dinner: null,
    }
    const fetchNutrition = vi.fn().mockResolvedValue(dayData)

    useAppStore.setState((state) => ({
      ...state,
      nutritionCache: { ...state.nutritionCache, [date]: dayData },
      fetchNutrition,
    }))

    renderRecords('/records')
    fireEvent.click(screen.getByRole('button', { name: '栄養' }))

    expect(await screen.findByText('表示元: 最新登録データ（昼）')).toBeInTheDocument()
    expect(screen.getByText('20.2 g')).toBeInTheDocument()
    expect(screen.getByText('基準: 18〜30 g')).toBeInTheDocument()
    expect(screen.getByText('基準: 3000以上 mg')).toBeInTheDocument()
    expect(screen.getByText('基準: 7.5未満 g')).toBeInTheDocument()
    expect(screen.getAllByText('基準: 未取得').length).toBeGreaterThan(0)
    expect(screen.queryByText('30.3 g')).not.toBeInTheDocument()
  })
})
