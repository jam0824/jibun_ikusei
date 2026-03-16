import { beforeEach, describe, expect, it } from 'vitest'
import { hydratePersistedState } from '@/domain/logic'
import { playAudioUrl } from '@/lib/tts'
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

  it('deletes an uncompleted quest', () => {
    const quest = useAppStore.getState().quests.find((entry) => entry.title === '企画メモを2ページ書く')
    expect(quest).toBeTruthy()

    const result = useAppStore.getState().deleteQuest(quest!.id)

    expect(result).toEqual({ ok: true })
    expect(useAppStore.getState().quests.find((entry) => entry.id === quest!.id)).toBeUndefined()
  })

  it('refuses to delete a quest with active completions', async () => {
    const quest = useAppStore.getState().quests.find((entry) => entry.title === '読書する')
    expect(quest).toBeTruthy()

    const completion = await useAppStore.getState().completeQuest(quest!.id, {
      completedAt: new Date().toISOString(),
      sourceScreen: 'home',
    })
    expect(completion.completionId).toBeTruthy()

    const result = useAppStore.getState().deleteQuest(quest!.id)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('履歴があるため削除できません。不要化したクエストはアーカイブしてください。')
    expect(useAppStore.getState().quests.find((entry) => entry.id === quest!.id)).toBeTruthy()
  })

  it('deletes undone completions and related assistant messages with the quest', async () => {
    const quest = useAppStore.getState().quests.find((entry) => entry.title === 'エアロバイクを漕ぐ')
    expect(quest).toBeTruthy()

    const result = await useAppStore.getState().completeQuest(quest!.id, {
      completedAt: new Date().toISOString(),
      sourceScreen: 'home',
    })
    expect(result.completionId).toBeTruthy()

    const completion = useAppStore.getState().completions.find((entry) => entry.id === result.completionId)
    expect(completion?.assistantMessageId).toBeTruthy()

    const undo = useAppStore.getState().undoCompletion(result.completionId!)
    expect(undo.ok).toBe(true)

    const deleteResult = useAppStore.getState().deleteQuest(quest!.id)

    expect(deleteResult).toEqual({ ok: true })
    expect(useAppStore.getState().quests.find((entry) => entry.id === quest!.id)).toBeUndefined()
    expect(useAppStore.getState().completions.find((entry) => entry.id === result.completionId)).toBeUndefined()
    expect(
      useAppStore.getState().assistantMessages.find((entry) => entry.id === completion!.assistantMessageId),
    ).toBeUndefined()
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

  it('returns a clear error instead of replaying cached audio while offline', async () => {
    const quest = useAppStore.getState().quests.find((entry) => entry.title === '読書する')
    expect(quest).toBeTruthy()

    const result = await useAppStore.getState().completeQuest(quest!.id, {
      completedAt: new Date().toISOString(),
      sourceScreen: 'home',
    })
    expect(result.completionId).toBeTruthy()

    const completion = useAppStore.getState().completions.find((entry) => entry.id === result.completionId)
    expect(completion?.assistantMessageId).toBeTruthy()

    await playAudioUrl(completion!.assistantMessageId!, 'blob:cached-audio')

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    })

    await expect(useAppStore.getState().playAssistantMessage(completion!.assistantMessageId!)).resolves.toBe(
      '音声再生はオフラインでは利用できません。ネットワーク接続を確認してください。',
    )
  })
})
