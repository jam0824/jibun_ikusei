import { describe, expect, it } from 'vitest'
import { hydratePersistedState, getQuestAvailability, buildTemplateSkillResolution, mergeImportedState } from '@/domain/logic'

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
      '今日は3ページ進んだ',
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
})
