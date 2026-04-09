import { describe, expect, it } from 'vitest'
import {
  buildTemplateSkillResolution,
  getCompletionCelebration,
  getFilteredActiveCompletions,
  getQuestAvailability,
  getQuestIdsWithActiveCompletions,
  getTodayActiveCompletions,
  getWeekActiveCompletions,
  hydratePersistedState,
  mergeImportedState,
} from '@/domain/logic'
import { getWeekKey } from '@/lib/date'

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
})
