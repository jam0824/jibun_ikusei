import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydratePersistedState } from '@/domain/logic'
import type { Quest, SkillResolutionResult } from '@/domain/types'
import * as aiLib from '@/lib/ai'
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

  it('keeps generated Lily text after delayed skill resolution completes', async () => {
    const state = useAppStore.getState()
    const skill = state.skills[0]
    expect(skill).toBeTruthy()

    const now = new Date().toISOString()
    const quest: Quest = {
      id: 'quest_async_race',
      title: '非同期競合テスト',
      description: 'Lily生成が先に終わる',
      questType: 'repeatable',
      xpReward: 7,
      category: '仕事',
      skillMappingMode: 'ai_auto',
      status: 'active',
      privacyMode: 'normal',
      pinned: false,
      createdAt: now,
      updatedAt: now,
    }

    useAppStore.getState().upsertQuest(quest)
    useAppStore.setState((current) => ({
      ...current,
      aiConfig: {
        ...current.aiConfig,
        providers: {
          ...current.aiConfig.providers,
          openai: {
            ...current.aiConfig.providers.openai,
            apiKey: 'sk-test',
          },
        },
      },
    }))

    let resolveSkillResult: ((value: SkillResolutionResult) => void) | undefined
    const resolveSkillPromise = new Promise<SkillResolutionResult>((resolve) => {
      resolveSkillResult = resolve
    })

    const generatedText = '生成されたLilyコメント'
    const resolveSkillSpy = vi.spyOn(aiLib, 'resolveSkillWithProvider').mockReturnValue(resolveSkillPromise)
    const lilySpy = vi.spyOn(aiLib, 'generateLilyMessageWithProvider').mockResolvedValue({
      intent: 'quest_completed',
      mood: 'bright',
      text: generatedText,
      shouldSpeak: false,
    })

    const completionResult = await useAppStore.getState().completeQuest(quest.id, {
      completedAt: new Date().toISOString(),
      sourceScreen: 'home',
    })
    expect(completionResult.completionId).toBeTruthy()
    const completionId = completionResult.completionId!

    await vi.waitFor(() => {
      const store = useAppStore.getState()
      const completion = store.completions.find((entry) => entry.id === completionId)
      const message = completion?.assistantMessageId
        ? store.assistantMessages.find((entry) => entry.id === completion.assistantMessageId)
        : undefined
      expect(message?.text).toBe(generatedText)
    })

    resolveSkillResult?.({
      action: 'assign_existing',
      skillName: skill!.name,
      category: skill!.category,
      confidence: 0.95,
      reason: 'テスト解決',
      candidateSkills: [skill!.name],
    })

    await vi.waitFor(() => {
      const store = useAppStore.getState()
      const completion = store.completions.find((entry) => entry.id === completionId)
      expect(completion?.resolvedSkillId).toBe(skill!.id)

      const message = completion?.assistantMessageId
        ? store.assistantMessages.find((entry) => entry.id === completion.assistantMessageId)
        : undefined
      expect(message?.text).toBe(generatedText)
    })

    expect(lilySpy).toHaveBeenCalledTimes(1)
    expect(resolveSkillSpy).toHaveBeenCalledTimes(1)
  })
})
