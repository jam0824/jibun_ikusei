import { describe, expect, it } from 'vitest'
import {
  buildTemplateSkillResolution,
  getQuestAvailability,
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
