import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { hydratePersistedState } from '@/domain/logic'
import type {
  NutrientEntry,
  NutrientMap,
  NutritionRecord,
  PersistedAppState,
  Quest,
  QuestCompletion,
  Skill,
} from '@/domain/types'
import { GrowthScreen } from '@/screens/growth-screen'
import { useAppStore } from '@/store/app-store'
import * as api from '@/lib/api-client'

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    getBrowsingTimes: vi.fn(),
    getNutrition: vi.fn(),
    getFitbitData: vi.fn(),
  }
})

function createQuest(
  id: string,
  title: string,
  category: string,
  overrides: Partial<Pick<Quest, 'xpReward' | 'pinned' | 'source' | 'fixedSkillId'>> = {},
): Quest {
  const now = '2026-04-01T09:00:00+09:00'
  return {
    id,
    title,
    description: `${title}の説明`,
    questType: 'repeatable',
    xpReward: overrides.xpReward ?? 5,
    category,
    skillMappingMode: 'fixed',
    fixedSkillId: overrides.fixedSkillId,
    cooldownMinutes: 0,
    dailyCompletionCap: 10,
    status: 'active',
    privacyMode: 'normal',
    pinned: overrides.pinned ?? false,
    source: overrides.source,
    createdAt: now,
    updatedAt: now,
  }
}

function createSkill(id: string, name: string, category: string): Skill {
  const now = '2026-04-01T09:00:00+09:00'
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    category,
    level: 1,
    totalXp: 0,
    source: 'manual',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

function createCompletion(
  id: string,
  questId: string,
  resolvedSkillId: string,
  completedAt: string,
  skillXpAwarded: number,
  userXpAwarded = 5,
): QuestCompletion {
  return {
    id,
    questId,
    clientRequestId: `req_${id}`,
    completedAt,
    userXpAwarded,
    skillXpAwarded,
    resolvedSkillId,
    skillResolutionStatus: 'resolved',
    createdAt: completedAt,
  }
}

function createNutritionEntry(value: number | null, unit = 'g', label: NutrientEntry['label'] = null): NutrientEntry {
  return {
    value,
    unit,
    label,
    threshold: null,
  }
}

function createNutritionMap(): NutrientMap {
  return {
    energy: createNutritionEntry(500, 'kcal', '適正'),
    protein: createNutritionEntry(20, 'g', '適正'),
    fat: createNutritionEntry(10, 'g', '適正'),
    carbs: createNutritionEntry(50, 'g', '不足'),
    potassium: createNutritionEntry(1200, 'mg', '不足'),
    calcium: createNutritionEntry(600, 'mg', '適正'),
    iron: createNutritionEntry(7, 'mg', '適正'),
    vitaminA: createNutritionEntry(700, 'µg', '適正'),
    vitaminE: createNutritionEntry(6, 'mg', '適正'),
    vitaminB1: createNutritionEntry(0.8, 'mg', '不足'),
    vitaminB2: createNutritionEntry(1.2, 'mg', '適正'),
    vitaminB6: createNutritionEntry(1.1, 'mg', '適正'),
    vitaminC: createNutritionEntry(90, 'mg', '適正'),
    fiber: createNutritionEntry(15, 'g', '不足'),
    saturatedFat: createNutritionEntry(7, 'g', '適正'),
    salt: createNutritionEntry(9, 'g', '過剰'),
  }
}

function createNutritionRecord(date = '2026-04-12'): NutritionRecord {
  const now = `${date}T12:00:00+09:00`
  return {
    userId: 'user_1',
    date,
    mealType: 'daily',
    nutrients: createNutritionMap(),
    createdAt: now,
    updatedAt: now,
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

function renderGrowth() {
  return render(
    <MemoryRouter initialEntries={['/growth']}>
      <Routes>
        <Route path="/growth" element={<GrowthScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('growth screen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T12:00:00+09:00'))
    vi.mocked(api.getBrowsingTimes).mockResolvedValue([])
    vi.mocked(api.getNutrition).mockResolvedValue({
      daily: null,
      breakfast: null,
      lunch: null,
      dinner: null,
    })
    vi.mocked(api.getFitbitData).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the growth summary, skill list, and at most three recommended quests', async () => {
    resetStore({
      quests: [
        createQuest('quest_read', '読書する', '学習', { fixedSkillId: 'skill_reading', pinned: true, xpReward: 20 }),
        createQuest('quest_research', '調べものをする', '学習', { fixedSkillId: 'skill_research', xpReward: 18 }),
        createQuest('quest_write', '企画を書く', '仕事', { fixedSkillId: 'skill_writing', xpReward: 16 }),
        createQuest('quest_house', '部屋を整える', '生活', { fixedSkillId: 'skill_housework', xpReward: 14 }),
        createQuest('quest_browsing', '閲覧クエスト', '学習', {
          fixedSkillId: 'skill_reading',
          source: 'browsing',
          xpReward: 100,
        }),
        createQuest('quest_misc', '雑記する', 'その他', { fixedSkillId: 'skill_misc', xpReward: 8 }),
      ],
      skills: [
        createSkill('skill_reading', '読書', '学習'),
        createSkill('skill_research', '調査', '学習'),
        createSkill('skill_writing', '文書作成', '仕事'),
        createSkill('skill_housework', '家事', '生活'),
        createSkill('skill_misc', '雑記', 'その他'),
      ],
      completions: [
        createCompletion('completion_read_recent', 'quest_read', 'skill_reading', '2026-04-10T08:00:00+09:00', 10),
        createCompletion('completion_read_old', 'quest_read', 'skill_reading', '2026-03-25T08:00:00+09:00', 40),
        createCompletion('completion_research_recent', 'quest_research', 'skill_research', '2026-04-08T20:00:00+09:00', 20),
        createCompletion('completion_research_old', 'quest_research', 'skill_research', '2026-03-20T20:00:00+09:00', 30),
        createCompletion('completion_write_recent', 'quest_write', 'skill_writing', '2026-04-11T09:00:00+09:00', 25),
        createCompletion('completion_house_recent', 'quest_house', 'skill_housework', '2026-04-12T07:00:00+09:00', 5),
        createCompletion('completion_misc_recent', 'quest_misc', 'skill_misc', '2026-04-07T21:00:00+09:00', 15),
      ],
      assistantMessages: [
        {
          id: 'message_status',
          triggerType: 'daily_summary',
          mood: 'calm',
          text: '知識と実務がいい流れで伸びています。',
          createdAt: '2026-04-12T10:00:00+09:00',
        },
      ],
    })

    renderGrowth()
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(screen.getByText('今の伸び方と次の一手をまとめて確認できます。')).toBeInTheDocument()
    expect(screen.getByText('知識 × 実務型')).toBeInTheDocument()
    expect(screen.getByText('知識と実務がいい流れで伸びています。')).toBeInTheDocument()
    expect(screen.getByText('最近の伸び')).toBeInTheDocument()
    expect(screen.getByText('スキル一覧')).toBeInTheDocument()
    expect(screen.getAllByText('読書').length).toBeGreaterThan(0)
    expect(screen.getAllByText('調査').length).toBeGreaterThan(0)
    expect(screen.getByText('その他の成長')).toBeInTheDocument()
    expect(screen.getByText('次の一手')).toBeInTheDocument()
    expect(screen.getByText('読書する')).toBeInTheDocument()
    expect(screen.getByText('調べものをする')).toBeInTheDocument()
    expect(screen.getByText('企画を書く')).toBeInTheDocument()
    expect(screen.queryByText('部屋を整える')).not.toBeInTheDocument()
    expect(screen.queryByText('閲覧クエスト')).not.toBeInTheDocument()
    expect(screen.getByText('健康データはまだありません')).toBeInTheDocument()
    expect(screen.getByText('栄養データはまだありません')).toBeInTheDocument()
    expect(screen.getByText('閲覧データはまだありません')).toBeInTheDocument()
  })

  it('renders supplemental health, nutrition, and browsing data when available', async () => {
    vi.mocked(api.getFitbitData).mockResolvedValue([
      {
        date: '2026-04-12',
        heart: {
          resting_heart_rate: 58,
          intraday_points: 0,
          heart_zones: [],
        },
        active_zone_minutes: null,
        sleep: {
          main_sleep: {
            date_of_sleep: '2026-04-12',
            start_time: '2026-04-11T23:30:00.000',
            end_time: '2026-04-12T06:30:00.000',
            minutes_asleep: 420,
            minutes_awake: 20,
            time_in_bed: 440,
            deep_minutes: 80,
            light_minutes: 220,
            rem_minutes: 120,
            wake_minutes: 20,
          },
          all_sleep_count: 1,
        },
        activity: {
          steps: 8123,
          distance: 5.4,
          calories: 2100,
          very_active_minutes: 12,
          fairly_active_minutes: 18,
          lightly_active_minutes: 30,
          sedentary_minutes: 500,
        },
      },
    ])
    vi.mocked(api.getNutrition).mockResolvedValue({
      daily: createNutritionRecord(),
      breakfast: null,
      lunch: null,
      dinner: null,
    })
    vi.mocked(api.getBrowsingTimes).mockResolvedValue([
      {
        date: '2026-04-12',
        domains: {
          'github.com': { totalSeconds: 3600, category: '学習', isGrowth: true },
          'youtube.com': { totalSeconds: 1800, category: '娯楽', isGrowth: false },
        },
        totalSeconds: 5400,
      },
    ])

    resetStore({
      quests: [createQuest('quest_read', '読書する', '学習', { fixedSkillId: 'skill_reading' })],
      skills: [createSkill('skill_reading', '読書', '学習')],
      completions: [
        createCompletion('completion_read', 'quest_read', 'skill_reading', '2026-04-12T08:00:00+09:00', 5),
      ],
    })

    renderGrowth()
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(screen.getByText('8,123 歩')).toBeInTheDocument()
    expect(screen.getByText('7時間0分')).toBeInTheDocument()
    expect(screen.getByText('58 bpm')).toBeInTheDocument()
    expect(screen.getByText('不足 4件')).toBeInTheDocument()
    expect(screen.getByText('適正 11件')).toBeInTheDocument()
    expect(screen.getByText('過剰 1件')).toBeInTheDocument()
    expect(screen.getByText('成長系 1時間0分')).toBeInTheDocument()
    expect(screen.getByText('その他 30分')).toBeInTheDocument()
  })

  it('keeps the main status content visible when supplemental fetches fail', async () => {
    vi.mocked(api.getFitbitData).mockRejectedValue(new Error('fitbit failed'))
    vi.mocked(api.getNutrition).mockRejectedValue(new Error('nutrition failed'))
    vi.mocked(api.getBrowsingTimes).mockRejectedValue(new Error('browsing failed'))

    resetStore({
      quests: [createQuest('quest_read', '読書する', '学習', { fixedSkillId: 'skill_reading' })],
      skills: [createSkill('skill_reading', '読書', '学習')],
      completions: [
        createCompletion('completion_read', 'quest_read', 'skill_reading', '2026-04-12T08:00:00+09:00', 5),
      ],
      assistantMessages: [
        {
          id: 'message_status',
          triggerType: 'daily_summary',
          mood: 'calm',
          text: '今日も一歩ずつ進めましょう。',
          createdAt: '2026-04-12T10:00:00+09:00',
        },
      ],
    })

    renderGrowth()
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(screen.getByText('今日も一歩ずつ進めましょう。')).toBeInTheDocument()
    expect(screen.getByText('健康データを取得できませんでした')).toBeInTheDocument()
    expect(screen.getByText('栄養データを取得できませんでした')).toBeInTheDocument()
    expect(screen.getByText('閲覧データを取得できませんでした')).toBeInTheDocument()
  })
})
