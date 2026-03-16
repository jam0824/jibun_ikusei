import { beforeEach, describe, expect, it } from 'vitest'
import { hydratePersistedState } from '@/domain/logic'
import { useAppStore } from '@/store/app-store'

function resetStore() {
  const base = hydratePersistedState()
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
  }))
}

describe('app store', () => {
  beforeEach(() => {
    resetStore()
  })

  it('completes and undoes a fixed-skill quest', async () => {
    const quest = useAppStore.getState().quests.find((entry) => entry.title === '読書する')
    expect(quest).toBeTruthy()

    const result = await useAppStore.getState().completeQuest(quest!.id, {
      completedAt: new Date().toISOString(),
      sourceScreen: 'home',
    })

    expect(result.completionId).toBeTruthy()
    expect(useAppStore.getState().user.totalXp).toBe(quest!.xpReward)

    const completion = useAppStore.getState().completions.find((entry) => entry.id === result.completionId)
    expect(completion?.resolvedSkillId).toBe(quest!.fixedSkillId)

    const undo = useAppStore.getState().undoCompletion(result.completionId!)
    expect(undo.ok).toBe(true)
    expect(useAppStore.getState().user.totalXp).toBe(0)
  })

  it('merges skills and rewrites quest references', () => {
    const state = useAppStore.getState()
    const reading = state.skills.find((entry) => entry.name === '読書')
    const exercise = state.skills.find((entry) => entry.name === '有酸素運動')
    const exerciseQuest = state.quests.find((entry) => entry.title === 'エアロバイクを漕ぐ')
    expect(reading).toBeTruthy()
    expect(exercise).toBeTruthy()
    expect(exerciseQuest).toBeTruthy()

    const result = useAppStore.getState().mergeSkills(exercise!.id, reading!.id)
    expect(result.ok).toBe(true)

    const nextState = useAppStore.getState()
    expect(nextState.skills.find((entry) => entry.id === exercise!.id)?.status).toBe('merged')
    expect(nextState.quests.find((entry) => entry.id === exerciseQuest!.id)?.fixedSkillId).toBe(reading!.id)
  })
})
