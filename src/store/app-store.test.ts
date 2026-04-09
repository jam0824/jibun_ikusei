import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as domainLogic from '@/domain/logic'
import { hydratePersistedState } from '@/domain/logic'
import type { Quest, SkillResolutionResult } from '@/domain/types'
import * as aiLib from '@/lib/ai'
import * as api from '@/lib/api-client'
import * as storage from '@/lib/storage'
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

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('keeps resolvedSkillId aligned with the created skill id in fallback mode', async () => {
    const now = new Date().toISOString()
    const quest: Quest = {
      id: 'quest_fallback_skill_id_alignment',
      title: '記号スキル作成テスト',
      description: 'fallback path',
      questType: 'repeatable',
      xpReward: 6,
      category: 'その他',
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
      settings: {
        ...current.settings,
        aiEnabled: false,
      },
    }))

    vi.spyOn(domainLogic, 'buildTemplateSkillResolution').mockReturnValue({
      action: 'assign_seed',
      skillName: '!!!',
      category: 'その他',
      confidence: 0.9,
      reason: 'fallback test',
      candidateSkills: ['!!!'],
    })

    const completionResult = await useAppStore.getState().completeQuest(quest.id, {
      completedAt: now,
      sourceScreen: 'home',
    })

    expect(completionResult.completionId).toBeTruthy()
    const store = useAppStore.getState()
    const completion = store.completions.find((entry) => entry.id === completionResult.completionId)
    expect(completion?.resolvedSkillId).toBeTruthy()
    expect(completion?.skillResolutionStatus).toBe('resolved')

    const resolvedSkill = completion?.resolvedSkillId
      ? store.skills.find((skill) => skill.id === completion.resolvedSkillId)
      : undefined
    expect(resolvedSkill?.name).toBe('!!!')
  })

  it('rolls back an optimistic completion when the server rejects a stale quest', async () => {
    const state = useAppStore.getState()
    const skill = state.skills[0]
    expect(skill).toBeTruthy()

    const now = new Date().toISOString()
    const quest: Quest = {
      id: 'quest_stale_completion',
      title: '削除済みクエストの再現',
      description: 'stale quest rollback test',
      questType: 'one_time',
      xpReward: 4,
      category: 'その他',
      skillMappingMode: 'fixed',
      fixedSkillId: skill!.id,
      status: 'active',
      privacyMode: 'normal',
      pinned: false,
      createdAt: now,
      updatedAt: now,
    }

    useAppStore.getState().upsertQuest(quest)

    const postCompletionSpy = vi
      .spyOn(api, 'postCompletion')
      .mockRejectedValueOnce(new api.ApiError('/completions', 400, { error: 'missing quest' }))
    const getQuestsSpy = vi.spyOn(api, 'getQuests').mockResolvedValueOnce([])
    const putUserSpy = vi.spyOn(api, 'putUser').mockResolvedValue({ updated: true })

    const result = await useAppStore.getState().completeQuest(quest.id, {
      completedAt: now,
      sourceScreen: 'home',
    })

    expect(result.completionId).toBeTruthy()

    await vi.waitFor(() => {
      const store = useAppStore.getState()
      expect(store.completions.find((entry) => entry.id === result.completionId)).toBeUndefined()
      expect(store.assistantMessages.find((entry) => entry.completionId === result.completionId)).toBeUndefined()
      expect(store.quests.find((entry) => entry.id === quest.id)).toBeUndefined()
      expect(store.personalSkillDictionary.some((entry) => entry.phrase === quest.title)).toBe(false)
      expect(store.user.totalXp).toBe(0)
    })

    expect(postCompletionSpy).toHaveBeenCalledTimes(1)
    expect(getQuestsSpy).toHaveBeenCalledTimes(1)
    expect(putUserSpy).not.toHaveBeenCalled()
  })

  it('drops local-only orphan completions after cloud sync during initialize', async () => {
    const completedAt = '2026-04-09T09:11:00+09:00'
    const local = hydratePersistedState({
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
      },
      quests: [],
      completions: [
        {
          id: 'completion_orphan_local',
          questId: 'quest_missing_local',
          clientRequestId: 'req_orphan_local',
          completedAt,
          userXpAwarded: 2,
          skillResolutionStatus: 'pending',
          assistantMessageId: 'msg_orphan_local',
          createdAt: completedAt,
        },
      ],
      assistantMessages: [
        {
          id: 'msg_orphan_local',
          triggerType: 'quest_completed',
          mood: 'bright',
          text: 'orphan completion message',
          completionId: 'completion_orphan_local',
          createdAt: completedAt,
        },
      ],
      skills: [],
      personalSkillDictionary: [],
    })

    vi.spyOn(storage, 'loadPersistedState').mockReturnValue(local)
    vi.spyOn(storage, 'loadFromCloud').mockResolvedValue({
      user: local.user,
      settings: local.settings,
      aiConfig: local.aiConfig,
      meta: local.meta,
      quests: [],
      completions: [],
      skills: [],
      personalSkillDictionary: [],
      assistantMessages: [],
    })

    useAppStore.setState((state) => ({
      ...state,
      ...hydratePersistedState({
        meta: {
          schemaVersion: 1,
          seededSampleData: true,
        },
        quests: [],
        completions: [],
        skills: [],
        assistantMessages: [],
        personalSkillDictionary: [],
      }),
      hydrated: false,
      importMode: 'merge',
      currentEffectCompletionId: undefined,
      busyQuestId: undefined,
      connectionState: {
        openai: { status: 'idle' },
        gemini: { status: 'idle' },
      },
    }))

    useAppStore.getState().initialize()

    await vi.waitFor(() => {
      const store = useAppStore.getState()
      expect(store.completions.find((entry) => entry.id === 'completion_orphan_local')).toBeUndefined()
      expect(store.assistantMessages.find((entry) => entry.id === 'msg_orphan_local')).toBeUndefined()
      expect(store.user.totalXp).toBe(0)
    })
  })

  it('syncs the meal system quest before posting its completion', async () => {
    const mealQuest = useAppStore.getState().quests.find((entry) => entry.systemKey === 'meal_register')
    expect(mealQuest).toBeTruthy()

    const now = new Date().toISOString()
    const postQuestSpy = vi.spyOn(api, 'postQuest').mockResolvedValue({
      ...mealQuest!,
      updatedAt: now,
    })
    const postCompletionSpy = vi.spyOn(api, 'postCompletion').mockResolvedValue({})
    const putUserSpy = vi.spyOn(api, 'putUser').mockResolvedValue({ updated: true })

    const result = await useAppStore.getState().completeQuest(mealQuest!.id, {
      completedAt: now,
      sourceScreen: 'meal',
    })

    expect(result.completionId).toBeTruthy()

    await vi.waitFor(() => {
      expect(postQuestSpy).toHaveBeenCalledTimes(1)
      expect(postCompletionSpy).toHaveBeenCalledTimes(1)
    })

    expect(postQuestSpy.mock.invocationCallOrder[0]).toBeLessThan(postCompletionSpy.mock.invocationCallOrder[0])
    expect(postQuestSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: mealQuest!.id,
      systemKey: 'meal_register',
    }))
    expect(putUserSpy).toHaveBeenCalled()
  })
})
