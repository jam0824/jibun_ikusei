import { describe, expect, it } from 'vitest'
import {
  buildTemplateSkillResolution,
  getQuestAvailability,
  getQuestIdsWithActiveCompletions,
  getTodayActiveCompletions,
  hydratePersistedState,
  mergeImportedState,
} from '@/domain/logic'

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

  it('migrates legacy provider defaults to current models and speaker', () => {
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
            ttsModel: 'gemini-2.5-flash-preview-tts',
            voice: 'Kore',
            updatedAt: new Date().toISOString(),
          },
        },
      },
    })

    expect(state.aiConfig.providers.openai.model).toBe('gpt-5.4')
    expect(state.aiConfig.providers.gemini.ttsModel).toBe('gemini-2.5-flash-tts')
    expect(state.aiConfig.providers.gemini.voice).toBe('Zephyr')
  })
})
