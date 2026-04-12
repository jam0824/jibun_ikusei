import { describe, expect, it } from 'vitest'
import {
  buildTemplateSkillResolution,
  getCompletionCelebration,
  getFilteredActiveCompletions,
  getPreviousWeekReflectionSummary,
  getQuestCompletionRanking,
  getQuestAvailability,
  getQuestIdsWithActiveCompletions,
  getStatusView,
  getTodayActiveCompletions,
  getWeekActiveCompletions,
  hydratePersistedState,
  mergeImportedState,
} from '@/domain/logic'
import { getWeekKey } from '@/lib/date'

function createRankingQuest(id: string, title: string) {
  const now = '2026-03-01T09:00:00+09:00'
  return {
    id,
    title,
    description: '',
    questType: 'repeatable' as const,
    xpReward: 5,
    category: '学習',
    skillMappingMode: 'ask_each_time' as const,
    cooldownMinutes: 0,
    dailyCompletionCap: 10,
    status: 'active' as const,
    privacyMode: 'normal' as const,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }
}

function createRankingCompletion(
  id: string,
  questId: string,
  completedAt: string,
  undoneAt?: string,
) {
  return {
    id,
    questId,
    clientRequestId: `req_${id}`,
    completedAt,
    userXpAwarded: 5,
    skillResolutionStatus: 'resolved' as const,
    undoneAt,
    createdAt: completedAt,
  }
}

function createStatusQuest(
  id: string,
  title: string,
  category: string,
  overrides: Partial<{
    xpReward: number
    source: 'manual' | 'browsing'
    fixedSkillId: string
  }> = {},
) {
  const now = '2026-03-01T09:00:00+09:00'
  return {
    id,
    title,
    description: `${title}の説明`,
    questType: 'repeatable' as const,
    xpReward: overrides.xpReward ?? 5,
    category,
    skillMappingMode: 'fixed' as const,
    fixedSkillId: overrides.fixedSkillId,
    cooldownMinutes: 0,
    dailyCompletionCap: 10,
    status: 'active' as const,
    privacyMode: 'normal' as const,
    pinned: false,
    source: overrides.source,
    createdAt: now,
    updatedAt: now,
  }
}

function createStatusSkill(id: string, name: string, category: string, status: 'active' | 'merged' = 'active') {
  const now = '2026-03-01T09:00:00+09:00'
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    category,
    level: 1,
    totalXp: 0,
    source: 'manual' as const,
    status,
    createdAt: now,
    updatedAt: now,
  }
}

function createStatusCompletion(
  id: string,
  questId: string,
  resolvedSkillId: string,
  completedAt: string,
  skillXpAwarded: number,
  userXpAwarded = 5,
) {
  return {
    id,
    questId,
    clientRequestId: `req_${id}`,
    completedAt,
    userXpAwarded,
    skillXpAwarded,
    resolvedSkillId,
    skillResolutionStatus: 'resolved' as const,
    createdAt: completedAt,
  }
}

describe('domain logic', () => {
  it('marks repeatable quest as cooling down after completion', () => {
    const state = hydratePersistedState()
    const quest = state.quests.find((entry) => entry.questType === 'repeatable')
    expect(quest).toBeTruthy()

    const nextState = {
      ...state,
      completions: [
        {
          id: 'completion_1',
          questId: quest!.id,
          clientRequestId: 'req_1',
          completedAt: new Date().toISOString(),
          userXpAwarded: quest!.xpReward,
          skillXpAwarded: quest!.xpReward,
          resolvedSkillId: quest!.fixedSkillId,
          skillResolutionStatus: 'resolved' as const,
          createdAt: new Date().toISOString(),
        },
      ],
    }

    const availability = getQuestAvailability(quest!, nextState.completions)
    expect(availability.state).toBe('cooling_down')
    expect(availability.canComplete).toBe(false)
  })

  it('keeps daily repeatable quests on the normal repeatable availability rules', () => {
    const now = new Date().toISOString()
    const quest = {
      id: 'quest_daily_repeatable',
      title: '朝のストレッチ',
      description: '',
      questType: 'repeatable',
      xpReward: 5,
      category: '運動',
      skillMappingMode: 'fixed',
      cooldownMinutes: 30,
      dailyCompletionCap: 2,
      isDaily: true,
      status: 'active',
      privacyMode: 'normal',
      pinned: false,
      createdAt: now,
      updatedAt: now,
    } as const

    const availability = getQuestAvailability(quest, [
      {
        id: 'completion_daily_repeatable',
        questId: quest.id,
        clientRequestId: 'req_daily_repeatable',
        completedAt: now,
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        createdAt: now,
      },
    ])

    expect(availability.state).toBe('cooling_down')
    expect(availability.canComplete).toBe(false)
  })

  it('uses dictionary match for local skill resolution', () => {
    const state = hydratePersistedState()
    const quest = state.quests.find((entry) => entry.title === '読書する')
    const skill = state.skills.find((entry) => entry.name === '読書')
    expect(quest).toBeTruthy()
    expect(skill).toBeTruthy()

    const result = buildTemplateSkillResolution(
      quest!,
      '今日は3ページ読んだ',
      state.skills,
      [
        {
          id: 'dict_1',
          phrase: '読書',
          mappedSkillId: skill!.id,
          createdBy: 'system',
          createdAt: new Date().toISOString(),
        },
      ],
    )

    expect(result.action).toBe('assign_existing')
    expect(result.skillName).toBe('読書')
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('returns a clear celebration when no level changed', () => {
    expect(
      getCompletionCelebration({
        userTotalXp: 45,
        userXpAwarded: 5,
        skillTotalXp: 18,
        skillXpAwarded: 8,
      }),
    ).toEqual({
      effect: 'clear',
      userLevelUp: false,
      skillLevelUp: false,
    })
  })

  it('returns a user level-up celebration when the user crosses the threshold', () => {
    expect(
      getCompletionCelebration({
        userTotalXp: 100,
        userXpAwarded: 10,
        skillTotalXp: 12,
        skillXpAwarded: 6,
      }),
    ).toEqual({
      effect: 'user-level-up',
      userLevelUp: true,
      skillLevelUp: false,
    })
  })

  it('returns a skill level-up celebration when only the skill crosses the threshold', () => {
    expect(
      getCompletionCelebration({
        userTotalXp: 55,
        userXpAwarded: 5,
        skillTotalXp: 50,
        skillXpAwarded: 7,
      }),
    ).toEqual({
      effect: 'skill-level-up',
      userLevelUp: false,
      skillLevelUp: true,
    })
  })

  it('prioritizes the user celebration when both user and skill level up', () => {
    expect(
      getCompletionCelebration({
        userTotalXp: 200,
        userXpAwarded: 10,
        skillTotalXp: 100,
        skillXpAwarded: 5,
      }),
    ).toEqual({
      effect: 'user-level-up',
      userLevelUp: true,
      skillLevelUp: true,
    })
  })

  it('does not mark a skill level-up when there is no awarded skill xp', () => {
    expect(
      getCompletionCelebration({
        userTotalXp: 40,
        userXpAwarded: 5,
        skillTotalXp: 50,
      }),
    ).toEqual({
      effect: 'clear',
      userLevelUp: false,
      skillLevelUp: false,
    })
  })

  it('treats exact threshold hits as level-ups', () => {
    expect(
      getCompletionCelebration({
        userTotalXp: 100,
        userXpAwarded: 100,
        skillTotalXp: 50,
        skillXpAwarded: 50,
      }),
    ).toEqual({
      effect: 'user-level-up',
      userLevelUp: true,
      skillLevelUp: true,
    })
  })

  it('returns only active completions completed on the same local calendar day', () => {
    const referenceDate = new Date(2026, 2, 17, 12, 0, 0)
    const todayActive = new Date(2026, 2, 17, 8, 30, 0).toISOString()
    const todayUndone = new Date(2026, 2, 17, 9, 0, 0).toISOString()
    const yesterday = new Date(2026, 2, 16, 23, 59, 0).toISOString()

    const completions = [
      {
        id: 'completion_today_active',
        questId: 'quest_repeatable',
        clientRequestId: 'req_today_active',
        completedAt: todayActive,
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        createdAt: todayActive,
      },
      {
        id: 'completion_today_undone',
        questId: 'quest_repeatable',
        clientRequestId: 'req_today_undone',
        completedAt: todayUndone,
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        undoneAt: new Date(2026, 2, 17, 9, 5, 0).toISOString(),
        createdAt: todayUndone,
      },
      {
        id: 'completion_yesterday',
        questId: 'quest_repeatable',
        clientRequestId: 'req_yesterday',
        completedAt: yesterday,
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        createdAt: yesterday,
      },
    ]

    const todayCompletions = getTodayActiveCompletions(completions, referenceDate)
    expect(todayCompletions).toHaveLength(1)
    expect(todayCompletions[0]?.id).toBe('completion_today_active')
  })

  it('returns only active completions completed during the same ISO week', () => {
    const referenceDate = new Date('2026-03-19T12:00:00+09:00')
    const completions = [
      {
        id: 'completion_this_week_today',
        questId: 'quest_today',
        clientRequestId: 'req_today',
        completedAt: '2026-03-19T08:30:00+09:00',
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        createdAt: '2026-03-19T08:30:00+09:00',
      },
      {
        id: 'completion_this_week_monday',
        questId: 'quest_monday',
        clientRequestId: 'req_monday',
        completedAt: '2026-03-16T19:45:00+09:00',
        userXpAwarded: 8,
        skillResolutionStatus: 'resolved' as const,
        createdAt: '2026-03-16T19:45:00+09:00',
      },
      {
        id: 'completion_last_week_sunday',
        questId: 'quest_sunday',
        clientRequestId: 'req_sunday',
        completedAt: '2026-03-15T21:00:00+09:00',
        userXpAwarded: 10,
        skillResolutionStatus: 'resolved' as const,
        createdAt: '2026-03-15T21:00:00+09:00',
      },
      {
        id: 'completion_undone_this_week',
        questId: 'quest_undone',
        clientRequestId: 'req_undone',
        completedAt: '2026-03-17T07:00:00+09:00',
        userXpAwarded: 3,
        skillResolutionStatus: 'resolved' as const,
        undoneAt: '2026-03-17T07:05:00+09:00',
        createdAt: '2026-03-17T07:00:00+09:00',
      },
    ]

    const weekCompletions = getWeekActiveCompletions(completions, referenceDate)

    expect(weekCompletions.map((completion) => completion.id)).toEqual([
      'completion_this_week_today',
      'completion_this_week_monday',
    ])
  })

  it('uses ISO week-year for week keys at year boundaries', () => {
    expect(getWeekKey('2027-01-01T12:00:00+09:00')).toBe('2026-W53')
  })

  it('keeps year-boundary week filtering aligned with ISO week-year', () => {
    const referenceDate = new Date('2027-01-01T12:00:00+09:00')
    const completions = [
      {
        id: 'completion_same_iso_week',
        questId: 'quest_december',
        clientRequestId: 'req_december',
        completedAt: '2026-12-28T09:00:00+09:00',
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        createdAt: '2026-12-28T09:00:00+09:00',
      },
      {
        id: 'completion_next_iso_week',
        questId: 'quest_next_week',
        clientRequestId: 'req_next_week',
        completedAt: '2027-01-04T09:00:00+09:00',
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        createdAt: '2027-01-04T09:00:00+09:00',
      },
    ]

    const weekCompletions = getFilteredActiveCompletions(completions, 'week', referenceDate)

    expect(weekCompletions).toHaveLength(1)
    expect(weekCompletions[0]?.id).toBe('completion_same_iso_week')
  })

  it('builds week quest rankings with previous-week counts and ignores undone completions', () => {
    const quests = [
      createRankingQuest('quest_reading', '朝の読書'),
      createRankingQuest('quest_run', '夜のランニング'),
      createRankingQuest('quest_review', '週次レビュー'),
    ]
    const completions = [
      createRankingCompletion('reading_week_1', 'quest_reading', '2026-03-19T08:30:00+09:00'),
      createRankingCompletion('reading_week_2', 'quest_reading', '2026-03-17T07:30:00+09:00'),
      createRankingCompletion('reading_prev_1', 'quest_reading', '2026-03-10T08:30:00+09:00'),
      createRankingCompletion(
        'reading_undone',
        'quest_reading',
        '2026-03-18T09:00:00+09:00',
        '2026-03-18T09:05:00+09:00',
      ),
      createRankingCompletion('run_week_1', 'quest_run', '2026-03-18T20:00:00+09:00'),
      createRankingCompletion('run_prev_1', 'quest_run', '2026-03-12T20:00:00+09:00'),
      createRankingCompletion('run_prev_2', 'quest_run', '2026-03-11T20:00:00+09:00'),
      createRankingCompletion('review_prev_1', 'quest_review', '2026-03-13T21:00:00+09:00'),
    ]

    const ranking = getQuestCompletionRanking(
      quests,
      completions,
      'week',
      new Date('2026-03-19T12:00:00+09:00'),
    )

    expect(ranking).toEqual([
      {
        questId: 'quest_reading',
        title: '朝の読書',
        currentCount: 2,
        previousWeekCount: 1,
        lastCompletedAt: '2026-03-19T08:30:00+09:00',
      },
      {
        questId: 'quest_run',
        title: '夜のランニング',
        currentCount: 1,
        previousWeekCount: 2,
        lastCompletedAt: '2026-03-18T20:00:00+09:00',
      },
    ])
  })

  it('sorts all-time rankings by count, latest completion, and title', () => {
    const quests = [
      createRankingQuest('quest_alpha', 'Alpha'),
      createRankingQuest('quest_beta', 'Beta'),
      createRankingQuest('quest_gamma', 'Gamma'),
      createRankingQuest('quest_delta', 'Delta'),
    ]
    const completions = [
      createRankingCompletion('alpha_1', 'quest_alpha', '2026-03-19T09:00:00+09:00'),
      createRankingCompletion('alpha_2', 'quest_alpha', '2026-03-18T09:00:00+09:00'),
      createRankingCompletion('alpha_3', 'quest_alpha', '2026-03-17T09:00:00+09:00'),
      createRankingCompletion('beta_1', 'quest_beta', '2026-03-19T08:00:00+09:00'),
      createRankingCompletion('beta_2', 'quest_beta', '2026-03-18T08:00:00+09:00'),
      createRankingCompletion('gamma_1', 'quest_gamma', '2026-03-19T08:00:00+09:00'),
      createRankingCompletion('gamma_2', 'quest_gamma', '2026-03-18T08:00:00+09:00'),
      createRankingCompletion('delta_1', 'quest_delta', '2026-03-16T08:00:00+09:00'),
      createRankingCompletion('delta_2', 'quest_delta', '2026-03-15T08:00:00+09:00'),
    ]

    const ranking = getQuestCompletionRanking(
      quests,
      completions,
      'all',
      new Date('2026-03-19T12:00:00+09:00'),
    )

    expect(ranking.map((entry) => entry.questId)).toEqual([
      'quest_alpha',
      'quest_beta',
      'quest_gamma',
      'quest_delta',
    ])
  })

  it('limits all-time rankings to the top 10 quests', () => {
    const quests = Array.from({ length: 11 }, (_, index) =>
      createRankingQuest(`quest_${index + 1}`, `クエスト${String(index + 1).padStart(2, '0')}`),
    )
    const completions = quests.flatMap((quest, index) =>
      Array.from({ length: 11 - index }, (_, completionIndex) =>
        createRankingCompletion(
          `${quest.id}_${completionIndex + 1}`,
          quest.id,
          `2026-03-${String(20 - completionIndex).padStart(2, '0')}T08:00:00+09:00`,
        ),
      ),
    )

    const ranking = getQuestCompletionRanking(
      quests,
      completions,
      'all',
      new Date('2026-03-19T12:00:00+09:00'),
    )

    expect(ranking).toHaveLength(10)
    expect(ranking.map((entry) => entry.questId)).not.toContain('quest_11')
  })

  it('collects quest ids that still have active completion history', () => {
    const now = new Date().toISOString()
    const completions = [
      {
        id: 'completion_repeatable_1',
        questId: 'quest_repeatable',
        clientRequestId: 'req_repeatable_1',
        completedAt: now,
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        createdAt: now,
      },
      {
        id: 'completion_repeatable_2',
        questId: 'quest_repeatable',
        clientRequestId: 'req_repeatable_2',
        completedAt: now,
        userXpAwarded: 5,
        skillResolutionStatus: 'resolved' as const,
        createdAt: now,
      },
      {
        id: 'completion_one_time_1',
        questId: 'quest_one_time',
        clientRequestId: 'req_one_time_1',
        completedAt: now,
        userXpAwarded: 20,
        skillResolutionStatus: 'resolved' as const,
        createdAt: now,
      },
      {
        id: 'completion_undone_only',
        questId: 'quest_undone_only',
        clientRequestId: 'req_undone_only',
        completedAt: now,
        userXpAwarded: 8,
        skillResolutionStatus: 'resolved' as const,
        undoneAt: now,
        createdAt: now,
      },
    ]

    const questIds = getQuestIdsWithActiveCompletions(completions)
    expect(Array.from(questIds).sort()).toEqual(['quest_one_time', 'quest_repeatable'])
    expect(questIds.has('quest_undone_only')).toBe(false)
  })

  it('keeps existing API keys when importing replacement data', () => {
    const current = hydratePersistedState()
    current.aiConfig.providers.openai.apiKey = 'sk-live-current'

    const replaced = mergeImportedState(
      current,
      {
        quests: [],
        completions: [],
        skills: [],
        assistantMessages: [],
        personalSkillDictionary: [],
      },
      'replace',
    )

    expect(replaced.aiConfig.providers.openai.apiKey).toBe('sk-live-current')
  })

  it('normalizes repeatable limits and strips one-time limits on hydrate', () => {
    const now = new Date().toISOString()
    const state = hydratePersistedState({
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
      },
      quests: [
        {
          id: 'quest_repeatable_invalid',
          title: '制約外クエスト',
          description: '',
          questType: 'repeatable',
          xpReward: 5,
          category: '学習',
          skillMappingMode: 'fixed',
          cooldownMinutes: -12,
          dailyCompletionCap: 999,
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'quest_one_time_invalid',
          title: '単発クエスト',
          description: '',
          questType: 'one_time',
          xpReward: 8,
          category: '生活',
          skillMappingMode: 'ai_auto',
          cooldownMinutes: 120,
          dailyCompletionCap: 3,
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const repeatable = state.quests.find((quest) => quest.id === 'quest_repeatable_invalid')
    const oneTime = state.quests.find((quest) => quest.id === 'quest_one_time_invalid')

    expect(repeatable?.cooldownMinutes).toBe(0)
    expect(repeatable?.dailyCompletionCap).toBe(10)
    expect(oneTime?.cooldownMinutes).toBeUndefined()
    expect(oneTime?.dailyCompletionCap).toBeUndefined()
  })

  it('treats missing isDaily as a non-daily repeatable quest on hydrate', () => {
    const now = new Date().toISOString()
    const state = hydratePersistedState({
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
      },
      quests: [
        {
          id: 'quest_repeatable_without_daily',
          title: 'repeatable',
          description: '',
          questType: 'repeatable',
          xpReward: 5,
          category: '学習',
          skillMappingMode: 'ai_auto',
          cooldownMinutes: 15,
          dailyCompletionCap: 3,
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const quest = state.quests.find((entry) => entry.id === 'quest_repeatable_without_daily') as
      | (typeof state.quests)[number] & { isDaily?: boolean }
      | undefined

    expect(quest?.isDaily).toBeUndefined()
  })

  it('strips isDaily from one-time quests on hydrate', () => {
    const now = new Date().toISOString()
    const state = hydratePersistedState({
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
      },
      quests: [
        {
          id: 'quest_one_time_daily_invalid',
          title: 'one-time',
          description: '',
          questType: 'one_time',
          xpReward: 8,
          category: '生活',
          skillMappingMode: 'ai_auto',
          isDaily: true,
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const quest = state.quests.find((entry) => entry.id === 'quest_one_time_daily_invalid') as
      | (typeof state.quests)[number] & { isDaily?: boolean }
      | undefined

    expect(quest?.isDaily).toBeUndefined()
  })

  it('normalizes imported repeatable limits before merge result is returned', () => {
    const current = hydratePersistedState({
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
      },
      quests: [],
    })
    const now = new Date().toISOString()

    const merged = mergeImportedState(
      current,
      {
        quests: [
          {
            id: 'quest_import_invalid',
            title: 'imported',
            description: '',
            questType: 'repeatable',
            xpReward: 5,
            category: '仕事',
            skillMappingMode: 'ai_auto',
            cooldownMinutes: 99999,
            dailyCompletionCap: 0,
            status: 'active',
            privacyMode: 'normal',
            pinned: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      'merge',
    )

    const importedQuest = merged.quests.find((quest) => quest.id === 'quest_import_invalid')
    expect(importedQuest?.cooldownMinutes).toBe(1440)
    expect(importedQuest?.dailyCompletionCap).toBe(1)
  })

  it('migrates legacy provider defaults to current models and speaker', () => {
    for (const legacyGeminiTtsModel of ['gemini-2.5-flash-tts', 'gemini-2.5-flash-lite-tts']) {
      const state = hydratePersistedState({
        aiConfig: {
          activeProvider: 'openai',
          providers: {
            openai: {
              apiKey: 'sk-test',
              model: 'gpt-5-mini',
              ttsModel: 'gpt-4o-mini-tts',
              voice: 'alloy',
              updatedAt: new Date().toISOString(),
            },
            gemini: {
              apiKey: 'gm-test',
              model: 'gemini-2.5-flash',
              ttsModel: legacyGeminiTtsModel,
              voice: 'Kore',
              updatedAt: new Date().toISOString(),
            },
          },
        },
      })

      expect(state.aiConfig.providers.openai.model).toBe('gpt-5.4')
      expect(state.aiConfig.providers.gemini.ttsModel).toBe('gemini-2.5-flash-preview-tts')
      expect(state.aiConfig.providers.gemini.voice).toBe('Zephyr')
    }
  })

  it('builds the previous-week reflection summary from manual quests only', () => {
    const state = hydratePersistedState({
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
      },
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
        {
          id: 'quest_focus',
          title: 'Deep work',
          description: '',
          questType: 'repeatable',
          xpReward: 8,
          category: 'Work',
          skillMappingMode: 'fixed',
          fixedSkillId: 'skill_focus',
          cooldownMinutes: 0,
          dailyCompletionCap: 10,
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          createdAt: '2026-04-01T09:00:00+09:00',
          updatedAt: '2026-04-01T09:00:00+09:00',
        },
        {
          id: 'quest_browsing',
          title: 'Good browsing',
          description: '',
          questType: 'repeatable',
          xpReward: 20,
          category: 'Browsing',
          skillMappingMode: 'fixed',
          fixedSkillId: 'skill_focus',
          cooldownMinutes: 0,
          dailyCompletionCap: 10,
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          source: 'browsing',
          browsingType: 'good',
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
        {
          id: 'skill_focus',
          name: 'Focus',
          normalizedName: 'focus',
          category: 'Work',
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
          id: 'daily_mon',
          questId: 'quest_daily',
          clientRequestId: 'req_daily_mon',
          completedAt: '2026-04-06T08:00:00+09:00',
          userXpAwarded: 3,
          skillXpAwarded: 3,
          resolvedSkillId: 'skill_habit',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-06T08:00:00+09:00',
        },
        {
          id: 'focus_tue',
          questId: 'quest_focus',
          clientRequestId: 'req_focus_tue',
          completedAt: '2026-04-07T09:00:00+09:00',
          userXpAwarded: 8,
          skillXpAwarded: 8,
          resolvedSkillId: 'skill_focus',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-07T09:00:00+09:00',
        },
        {
          id: 'daily_wed',
          questId: 'quest_daily',
          clientRequestId: 'req_daily_wed',
          completedAt: '2026-04-08T08:00:00+09:00',
          userXpAwarded: 3,
          skillXpAwarded: 3,
          resolvedSkillId: 'skill_habit',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-08T08:00:00+09:00',
        },
        {
          id: 'browsing_thu',
          questId: 'quest_browsing',
          clientRequestId: 'req_browsing_thu',
          completedAt: '2026-04-09T10:00:00+09:00',
          userXpAwarded: 20,
          skillXpAwarded: 20,
          resolvedSkillId: 'skill_focus',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-09T10:00:00+09:00',
        },
        {
          id: 'daily_fri',
          questId: 'quest_daily',
          clientRequestId: 'req_daily_fri',
          completedAt: '2026-04-10T08:00:00+09:00',
          userXpAwarded: 3,
          skillXpAwarded: 3,
          resolvedSkillId: 'skill_habit',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-10T08:00:00+09:00',
        },
        {
          id: 'focus_sat',
          questId: 'quest_focus',
          clientRequestId: 'req_focus_sat',
          completedAt: '2026-04-11T09:00:00+09:00',
          userXpAwarded: 8,
          skillXpAwarded: 8,
          resolvedSkillId: 'skill_focus',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-11T09:00:00+09:00',
        },
        {
          id: 'focus_undone',
          questId: 'quest_focus',
          clientRequestId: 'req_focus_undone',
          completedAt: '2026-04-12T09:00:00+09:00',
          userXpAwarded: 8,
          skillXpAwarded: 8,
          resolvedSkillId: 'skill_focus',
          skillResolutionStatus: 'resolved',
          undoneAt: '2026-04-12T09:05:00+09:00',
          createdAt: '2026-04-12T09:00:00+09:00',
        },
        {
          id: 'daily_prev',
          questId: 'quest_daily',
          clientRequestId: 'req_daily_prev',
          completedAt: '2026-04-05T08:00:00+09:00',
          userXpAwarded: 3,
          skillXpAwarded: 3,
          resolvedSkillId: 'skill_habit',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-05T08:00:00+09:00',
        },
        {
          id: 'focus_prev',
          questId: 'quest_focus',
          clientRequestId: 'req_focus_prev',
          completedAt: '2026-04-02T09:00:00+09:00',
          userXpAwarded: 8,
          skillXpAwarded: 8,
          resolvedSkillId: 'skill_focus',
          skillResolutionStatus: 'resolved',
          createdAt: '2026-04-02T09:00:00+09:00',
        },
      ],
      assistantMessages: [],
      personalSkillDictionary: [],
    })

    const summary = getPreviousWeekReflectionSummary(
      state,
      new Date('2026-04-14T12:00:00+09:00'),
    )

    expect(summary.weekKey).toBe('2026-W15')
    expect(summary.startDate).toBe('2026-04-06')
    expect(summary.endDate).toBe('2026-04-12')
    expect(summary.weekLabel).toBe('2026-04-06 〜 2026-04-12')
    expect(summary.hasData).toBe(true)
    expect(summary.totalCompletionCount).toBe(5)
    expect(summary.totalUserXp).toBe(25)
    expect(summary.activeDayCount).toBe(5)
    expect(summary.topSkill?.skillName).toBe('Focus')
    expect(summary.dailySummaries.map((entry) => `${entry.dayKey}:${entry.completionCount}/${entry.userXp}`)).toEqual([
      '2026-04-06:1/3',
      '2026-04-07:1/8',
      '2026-04-08:1/3',
      '2026-04-09:0/0',
      '2026-04-10:1/3',
      '2026-04-11:1/8',
      '2026-04-12:0/0',
    ])
    expect(summary.dailyQuestSummaries).toEqual([
      {
        questId: 'quest_daily',
        title: 'Morning stretch',
        currentDays: 3,
        previousDays: 1,
      },
    ])
    expect(summary.topQuestSummaries).toEqual([
      {
        questId: 'quest_daily',
        title: 'Morning stretch',
        currentCount: 3,
        previousCount: 1,
        lastCompletedAt: '2026-04-10T08:00:00+09:00',
      },
      {
        questId: 'quest_focus',
        title: 'Deep work',
        currentCount: 2,
        previousCount: 1,
        lastCompletedAt: '2026-04-11T09:00:00+09:00',
      },
    ])
    expect(summary.topSkillSummaries).toEqual([
      {
        skillId: 'skill_focus',
        skillName: 'Focus',
        currentXp: 16,
      },
      {
        skillId: 'skill_habit',
        skillName: 'Habit',
        currentXp: 9,
      },
    ])
  })

  it('keeps previous-week reflection ranges aligned at year boundaries', () => {
    const state = hydratePersistedState({
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
      },
      quests: [
        {
          id: 'quest_year_boundary',
          title: 'Year boundary quest',
          description: '',
          questType: 'repeatable',
          xpReward: 5,
          category: 'Study',
          skillMappingMode: 'ai_auto',
          cooldownMinutes: 0,
          dailyCompletionCap: 10,
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          createdAt: '2026-12-20T09:00:00+09:00',
          updatedAt: '2026-12-20T09:00:00+09:00',
        },
      ],
      completions: [
        {
          id: 'completion_year_boundary',
          questId: 'quest_year_boundary',
          clientRequestId: 'req_year_boundary',
          completedAt: '2026-12-29T09:00:00+09:00',
          userXpAwarded: 5,
          skillResolutionStatus: 'resolved',
          createdAt: '2026-12-29T09:00:00+09:00',
        },
      ],
      skills: [],
      assistantMessages: [],
      personalSkillDictionary: [],
    })

    const summary = getPreviousWeekReflectionSummary(
      state,
      new Date('2027-01-10T12:00:00+09:00'),
    )

    expect(summary.weekKey).toBe('2026-W53')
    expect(summary.startDate).toBe('2026-12-28')
    expect(summary.endDate).toBe('2027-01-03')
    expect(summary.weekLabel).toBe('2026-12-28 〜 2027-01-03')
    expect(summary.totalCompletionCount).toBe(1)
  })

  it('builds status categories, representative skills, and the current type from recent activity', () => {
    const state = hydratePersistedState({
      quests: [
        createStatusQuest('quest_read', '読書する', '学習', { fixedSkillId: 'skill_reading' }),
        createStatusQuest('quest_research', '調べものをする', '学習', { fixedSkillId: 'skill_research' }),
        createStatusQuest('quest_write', '企画を書く', '仕事', { fixedSkillId: 'skill_writing' }),
        createStatusQuest('quest_house', '部屋を整える', '生活', { fixedSkillId: 'skill_housework' }),
        createStatusQuest('quest_misc', '気分転換する', 'その他', { fixedSkillId: 'skill_misc' }),
      ],
      skills: [
        createStatusSkill('skill_reading', '読書', '学習'),
        createStatusSkill('skill_research', '調査', '学習'),
        createStatusSkill('skill_writing', '文書作成', '仕事'),
        createStatusSkill('skill_housework', '家事', '生活'),
        createStatusSkill('skill_misc', '雑記', 'その他'),
      ],
      completions: [
        createStatusCompletion('completion_read_recent', 'quest_read', 'skill_reading', '2026-04-10T08:00:00+09:00', 10),
        createStatusCompletion('completion_read_old', 'quest_read', 'skill_reading', '2026-03-25T08:00:00+09:00', 40),
        createStatusCompletion('completion_research_recent', 'quest_research', 'skill_research', '2026-04-08T20:00:00+09:00', 20),
        createStatusCompletion('completion_research_old', 'quest_research', 'skill_research', '2026-03-20T20:00:00+09:00', 30),
        createStatusCompletion('completion_write_recent', 'quest_write', 'skill_writing', '2026-04-11T09:00:00+09:00', 25),
        createStatusCompletion('completion_house_recent', 'quest_house', 'skill_housework', '2026-04-12T07:00:00+09:00', 5),
        createStatusCompletion('completion_misc_recent', 'quest_misc', 'skill_misc', '2026-04-07T21:00:00+09:00', 15),
      ],
    })

    const view = getStatusView(state, new Date('2026-04-12T12:00:00+09:00'))
    const knowledge = view.primaryCategories.find((entry) => entry.label === '知識')
    const practical = view.primaryCategories.find((entry) => entry.label === '実務')

    expect(knowledge).toMatchObject({
      totalXp: 100,
      level: 3,
      recentXp: 30,
    })
    expect(knowledge?.representativeSkill?.name).toBe('調査')
    expect(practical).toMatchObject({
      totalXp: 25,
      level: 1,
      recentXp: 25,
    })
    expect(view.currentType.label).toBe('知識 × 実務型')
    expect(view.topGrowthCategories.map((entry) => entry.label)).toEqual(['知識', '実務', '生活'])
    expect(view.otherCategory?.totalXp).toBe(15)
    expect(view.otherCategory?.skills.map((skill) => skill.name)).toEqual(['雑記'])
  })

  it('shows a placeholder current type when there is no recent 30-day skill xp', () => {
    const state = hydratePersistedState({
      quests: [
        createStatusQuest('quest_read', '読書する', '学習', { fixedSkillId: 'skill_reading' }),
      ],
      skills: [createStatusSkill('skill_reading', '読書', '学習')],
      completions: [
        createStatusCompletion('completion_old', 'quest_read', 'skill_reading', '2026-03-01T08:00:00+09:00', 20),
      ],
    })

    const view = getStatusView(state, new Date('2026-04-12T12:00:00+09:00'))

    expect(view.currentType.label).toBeUndefined()
    expect(view.currentType.placeholder).toBe('最近の記録が増えると表示されます')
  })

  it('counts weekly action days without browsing-derived completions', () => {
    const state = hydratePersistedState({
      quests: [
        createStatusQuest('quest_manual_one', '朝の読書', '学習', { fixedSkillId: 'skill_reading' }),
        createStatusQuest('quest_manual_two', '企画を書く', '仕事', { fixedSkillId: 'skill_writing' }),
        createStatusQuest('quest_browsing', '閲覧クエスト', '学習', {
          fixedSkillId: 'skill_reading',
          source: 'browsing',
        }),
      ],
      skills: [
        createStatusSkill('skill_reading', '読書', '学習'),
        createStatusSkill('skill_writing', '文書作成', '仕事'),
      ],
      completions: [
        createStatusCompletion('completion_manual_one', 'quest_manual_one', 'skill_reading', '2026-04-07T08:00:00+09:00', 5),
        createStatusCompletion('completion_manual_two', 'quest_manual_two', 'skill_writing', '2026-04-08T09:00:00+09:00', 5),
        createStatusCompletion('completion_browsing', 'quest_browsing', 'skill_reading', '2026-04-09T10:00:00+09:00', 5),
      ],
    })

    const view = getStatusView(state, new Date('2026-04-12T12:00:00+09:00'))

    expect(view.condition.weekActionDays).toBe(2)
  })
})
