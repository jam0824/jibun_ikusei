import { create } from 'zustand'
import {
  buildFallbackCompletionMessage,
  buildTemplateSkillResolution,
  createAssistantMessage,
  createSkillRecord,
  getProviderConfig,
  getQuestAvailability,
  hasUsableAi,
  hydratePersistedState,
  maskApiKey,
  maybeCreatePeriodicMessages,
  mergeImportedState,
  normalizeSkillName,
  prepareExportPayload,
  reconcileState,
  resolveMergedSkillId,
} from '@/domain/logic'
import type {
  AiConfig,
  AssistantMessage,
  PersistedAppState,
  Quest,
  QuestCompletion,
  SkillResolutionResult,
  UserSettings,
} from '@/domain/types'
import { getDayKey, getWeekKey, isUndoable, nowIso } from '@/lib/date'
import {
  generateLilyMessageWithProvider,
  generateTtsAudio,
  resolveSkillWithProvider,
  testProviderConnection,
} from '@/lib/ai'
import { getOfflineMessage, isOffline, OfflineFeatureError } from '@/lib/network'
import { clearPersistedState, loadFromCloud, loadPersistedState, persistState } from '@/lib/storage'
import * as api from '@/lib/api-client'
import { getCachedAudio, playAudioUrl } from '@/lib/tts'
import { createId, downloadJson } from '@/lib/utils'
import { SKILL_XP_CAP } from '@/domain/constants'

type ImportMode = 'merge' | 'replace'

type CompletionOptions = {
  note?: string
  completedAt: string
  sourceScreen: 'home' | 'quest_list'
}

type ConnectionState = {
  status: 'idle' | 'testing' | 'success' | 'error'
  message?: string
}

interface AppStore extends PersistedAppState {
  hydrated: boolean
  busyQuestId?: string
  currentEffectCompletionId?: string
  connectionState: Record<'openai' | 'gemini', ConnectionState>
  importMode: ImportMode
  initialize: () => void
  upsertQuest: (quest: Quest) => void
  deleteQuest: (questId: string) => { ok: boolean; reason?: string }
  archiveQuest: (questId: string) => void
  reopenQuest: (questId: string) => void
  completeQuest: (questId: string, options: CompletionOptions) => Promise<{ completionId?: string; error?: string }>
  resolveCompletionCandidates: (completionId: string, result?: SkillResolutionResult) => Promise<void>
  confirmCompletionSkill: (completionId: string, skillId: string) => void
  undoCompletion: (completionId: string) => { ok: boolean; reason?: string }
  mergeSkills: (sourceSkillId: string, targetSkillId: string) => { ok: boolean; reason?: string }
  setSettings: (partial: Partial<UserSettings>) => void
  setAiConfig: (provider: 'openai' | 'gemini', patch: Partial<AiConfig['providers']['openai']>) => void
  setActiveProvider: (provider: AiConfig['activeProvider']) => void
  testConnection: (provider: 'openai' | 'gemini') => Promise<void>
  playAssistantMessage: (messageId: string) => Promise<string | undefined>
  exportData: () => void
  importData: (jsonText: string, mode: ImportMode) => { ok: boolean; reason?: string }
  resetLocalData: () => void
  setImportMode: (mode: ImportMode) => void
}

const recentQuestRequests = new Map<string, number>()

function toPersistedState(state: AppStore): PersistedAppState {
  const {
    user,
    settings,
    aiConfig,
    quests,
    completions,
    skills,
    personalSkillDictionary,
    assistantMessages,
    meta,
  } = state

  return {
    user,
    settings,
    aiConfig,
    quests,
    completions,
    skills,
    personalSkillDictionary,
    assistantMessages,
    meta,
  }
}

function scheduleNotification(message: AssistantMessage, settings: UserSettings) {
  if (
    typeof Notification === 'undefined' ||
    Notification.permission !== 'granted' ||
    !settings.notificationsEnabled
  ) {
    return
  }

  new Notification('自分育成アプリ', { body: message.text })
}

/** IDを持つ配列をマージ。同じIDは updatedAt/createdAt が新しい方を採用 */
function mergeArrayById<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  local: T[],
  cloud: T[],
): T[] {
  const map = new Map<string, T>()
  for (const item of cloud) map.set(item.id, item)
  for (const item of local) {
    const existing = map.get(item.id)
    if (!existing) {
      map.set(item.id, item)
    } else {
      const localTs = item.updatedAt ?? item.createdAt ?? ''
      const cloudTs = existing.updatedAt ?? existing.createdAt ?? ''
      if (localTs >= cloudTs) map.set(item.id, item)
    }
  }
  return Array.from(map.values())
}

function buildCompletionFallbackMessage(state: PersistedAppState, completion: QuestCompletion) {
  const quest = state.quests.find((entry) => entry.id === completion.questId)
  if (!quest) {
    return createAssistantMessage('quest_completed', 'クエストをクリアしました。', 'bright', completion.id)
  }

  const skill = completion.resolvedSkillId
    ? state.skills.find((entry) => entry.id === resolveMergedSkillId(completion.resolvedSkillId, state.skills))
    : undefined

  return {
    ...buildFallbackCompletionMessage({
      quest,
      skill,
    }),
    completionId: completion.id,
  }
}

function applySkillResolutionToCompletion(params: {
  state: PersistedAppState
  completionId: string
  skillId: string
  mode: Quest['skillMappingMode']
  source: 'manual' | 'ai' | 'seed'
  reason: string
}) {
  const { state, completionId, skillId, mode, source, reason } = params
  const completion = state.completions.find((entry) => entry.id === completionId)
  if (!completion) {
    return state
  }

  const quest = state.quests.find((entry) => entry.id === completion.questId)
  if (!quest) {
    return state
  }

  const updatedCompletions = state.completions.map((entry) =>
    entry.id === completionId
      ? {
          ...entry,
          resolvedSkillId: skillId,
          skillResolutionStatus: 'resolved' as const,
          skillXpAwarded: Math.min(quest.xpReward, SKILL_XP_CAP),
          candidateSkillIds: [],
          resolutionReason: reason,
        }
      : entry,
  )

  const updatedQuests =
    mode === 'ask_each_time'
      ? state.quests
      : state.quests.map((entry) =>
          entry.id === quest.id
            ? {
                ...entry,
                defaultSkillId: skillId,
                updatedAt: nowIso(),
              }
            : entry,
        )

  const updatedDictionary = state.personalSkillDictionary.some(
    (entry) => entry.phrase === quest.title && entry.mappedSkillId === skillId,
  )
    ? state.personalSkillDictionary
    : [
        {
          id: createId('dict'),
          phrase: quest.title,
          mappedSkillId: skillId,
          createdBy: (source === 'ai' ? 'system' : 'user_override') as 'system' | 'user_override',
          createdAt: nowIso(),
        },
        ...state.personalSkillDictionary,
      ]

  return reconcileState({
    ...state,
    quests: updatedQuests,
    completions: updatedCompletions,
    personalSkillDictionary: updatedDictionary,
  })
}

export const useAppStore = create<AppStore>((set, get) => ({
  ...hydratePersistedState(loadPersistedState()),
  hydrated: false,
  connectionState: {
    openai: { status: 'idle' },
    gemini: { status: 'idle' },
  },
  importMode: 'merge',

  initialize: () => {
    if (get().hydrated) {
      return
    }

    // まずlocalStorageで即時初期化（画面をすぐ表示するため）
    const rawLocal = loadPersistedState()
    const local = maybeCreatePeriodicMessages(hydratePersistedState(rawLocal))
    set({
      ...local,
      hydrated: true,
      meta: {
        ...local.meta,
        notificationPermission:
          typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      },
    })

    // バックグラウンドでクラウドからロード → エンティティ単位でマージ
    void loadFromCloud().then((cloud) => {
      if (!cloud) {
        // クラウドにデータなし → ローカルに実データがあれば保持
        const localUpdatedAt = rawLocal.user?.updatedAt as string | undefined
        if (localUpdatedAt) persistState(local)
        return
      }

      // 各エンティティを個別にマージ（updatedAt が新しい方を採用）
      const pickNewer = <T extends { updatedAt?: string }>(localVal: T, cloudVal: T | undefined): T => {
        if (!cloudVal) return localVal
        return (cloudVal.updatedAt ?? '') > (localVal.updatedAt ?? '') ? cloudVal : localVal
      }

      const merged = reconcileState({
        ...local,
        user: pickNewer(local.user, cloud.user as typeof local.user | undefined),
        settings: pickNewer(local.settings, cloud.settings as typeof local.settings | undefined),
        aiConfig: local.aiConfig, // APIキーはローカル優先
        meta: local.meta,
        quests: mergeArrayById(local.quests, cloud.quests ?? []),
        completions: mergeArrayById(local.completions, cloud.completions ?? []),
        skills: mergeArrayById(local.skills, cloud.skills ?? []),
        personalSkillDictionary: mergeArrayById(local.personalSkillDictionary, cloud.personalSkillDictionary ?? []),
        assistantMessages: mergeArrayById(local.assistantMessages, cloud.assistantMessages ?? []),
      })
      const hydrated = maybeCreatePeriodicMessages(merged)
      persistState(hydrated)
      set({
        ...hydrated,
        hydrated: true,
        meta: {
          ...hydrated.meta,
          notificationPermission:
            typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
        },
      })
    })
  },

  upsertQuest: (quest) => {
    const state = get()
    const existing = state.quests.some((entry) => entry.id === quest.id)
    const updatedQuest = existing
      ? { ...quest, updatedAt: nowIso() }
      : { ...quest, createdAt: nowIso(), updatedAt: nowIso() }
    const nextState = reconcileState({
      ...state,
      quests: existing
        ? state.quests.map((entry) => (entry.id === quest.id ? updatedQuest : entry))
        : [updatedQuest, ...state.quests],
    })
    persistState(nextState)
    set(nextState)
    if (existing) {
      void api.putQuest(quest.id, updatedQuest).catch(() => undefined)
    } else {
      void api.postQuest(updatedQuest).catch(() => undefined)
    }
  },

  deleteQuest: (questId) => {
    const state = get()
    const quest = state.quests.find((entry) => entry.id === questId)
    if (!quest) {
      return { ok: false, reason: 'クエストが見つかりません。' }
    }

    const hasActiveCompletion = state.completions.some(
      (completion) => completion.questId === questId && !completion.undoneAt,
    )
    if (hasActiveCompletion) {
      return {
        ok: false,
        reason: '履歴があるため削除できません。不要化したクエストはアーカイブしてください。',
      }
    }

    const removedCompletions = state.completions.filter((completion) => completion.questId === questId)
    const removedCompletionIds = new Set(removedCompletions.map((completion) => completion.id))
    const removedAssistantMessageIds = new Set(
      removedCompletions
        .map((completion) => completion.assistantMessageId)
        .filter((value): value is string => Boolean(value)),
    )

    for (const recentKey of Array.from(recentQuestRequests.keys())) {
      if (recentKey.startsWith(`${questId}:`)) {
        recentQuestRequests.delete(recentKey)
      }
    }

    const nextState = reconcileState({
      ...state,
      quests: state.quests.filter((entry) => entry.id !== questId),
      completions: state.completions.filter((completion) => completion.questId !== questId),
      assistantMessages: state.assistantMessages.filter(
        (message) =>
          !removedAssistantMessageIds.has(message.id) &&
          !(message.completionId && removedCompletionIds.has(message.completionId)),
      ),
    })

    persistState(nextState)
    set({
      ...nextState,
      busyQuestId: state.busyQuestId === questId ? undefined : state.busyQuestId,
      currentEffectCompletionId:
        state.currentEffectCompletionId && removedCompletionIds.has(state.currentEffectCompletionId)
          ? undefined
          : state.currentEffectCompletionId,
    })
    void api.deleteQuest(questId).catch(() => undefined)

    return { ok: true }
  },

  archiveQuest: (questId) => {
    const state = get()
    const nextState = reconcileState({
      ...state,
      quests: state.quests.map((quest) =>
        quest.id === questId
          ? {
              ...quest,
              status: 'archived',
              updatedAt: nowIso(),
            }
          : quest,
      ),
    })
    persistState(nextState)
    set(nextState)
    void api.putQuest(questId, { status: 'archived', updatedAt: nowIso() }).catch(() => undefined)
  },

  reopenQuest: (questId) => {
    const state = get()
    const nextState = reconcileState({
      ...state,
      quests: state.quests.map((quest) =>
        quest.id === questId
          ? {
              ...quest,
              status: 'active',
              updatedAt: nowIso(),
            }
          : quest,
      ),
    })
    persistState(nextState)
    set(nextState)
    void api.putQuest(questId, { status: 'active', updatedAt: nowIso() }).catch(() => undefined)
  },

  completeQuest: async (questId, options) => {
    const state = get()
    const quest = state.quests.find((entry) => entry.id === questId)
    if (!quest) {
      return { error: 'クエストが見つかりません。' }
    }

    const availability = getQuestAvailability(quest, state.completions)
    if (!availability.canComplete) {
      return { error: availability.label }
    }

    const recentKey = `${questId}:${getDayKey(new Date())}`
    const recentTimestamp = recentQuestRequests.get(recentKey)
    if (recentTimestamp && Date.now() - recentTimestamp < 2500) {
      return { error: '連続で送信されました。少し待ってからもう一度試してください。' }
    }
    recentQuestRequests.set(recentKey, Date.now())

    const completionId = createId('completion')
    const createdAt = nowIso()
    const baseCompletion: QuestCompletion = {
      id: completionId,
      questId,
      clientRequestId: createId('req'),
      completedAt: options.completedAt,
      note: options.note?.trim() || undefined,
      userXpAwarded: quest.xpReward,
      skillResolutionStatus: 'pending',
      createdAt,
    }

    let nextState: PersistedAppState = {
      ...state,
      quests: state.quests.map((entry) =>
        entry.id === questId && quest.questType === 'one_time'
          ? {
              ...entry,
              status: 'completed',
              updatedAt: createdAt,
            }
          : entry,
      ),
      completions: [baseCompletion, ...state.completions],
    }

    const fallbackResolution =
      quest.skillMappingMode === 'fixed' && quest.fixedSkillId
        ? {
            action: 'assign_existing' as const,
            skillName:
              state.skills.find((skill) => skill.id === quest.fixedSkillId)?.name ?? '固定スキル',
            category:
              state.skills.find((skill) => skill.id === quest.fixedSkillId)?.category ??
              quest.category ??
              'その他',
            confidence: 1,
            reason: '固定スキル設定に基づいて即時反映しました。',
            candidateSkills: [
              state.skills.find((skill) => skill.id === quest.fixedSkillId)?.name ?? '固定スキル',
            ],
          }
        : buildTemplateSkillResolution(quest, baseCompletion.note, state.skills, state.personalSkillDictionary)

    if (quest.skillMappingMode === 'fixed' && quest.fixedSkillId) {
      nextState = applySkillResolutionToCompletion({
        state: nextState,
        completionId,
        skillId: quest.fixedSkillId,
        mode: quest.skillMappingMode,
        source: 'manual',
        reason: '固定スキル設定',
      })
    } else if (quest.skillMappingMode === 'ai_auto' && quest.defaultSkillId) {
      nextState = applySkillResolutionToCompletion({
        state: nextState,
        completionId,
        skillId: quest.defaultSkillId,
        mode: quest.skillMappingMode,
        source: 'ai',
        reason: '前回の解決結果を再利用',
      })
    } else if (!hasUsableAi(state.aiConfig, state.settings) || quest.privacyMode === 'no_ai') {
      const fallbackSkillName = fallbackResolution.skillName.trim()
      if (fallbackResolution.confidence >= 0.8 && fallbackSkillName && fallbackSkillName !== '未分類') {
        const existing = nextState.skills.find(
          (skill) => normalizeSkillName(skill.name) === normalizeSkillName(fallbackSkillName),
        )
        let skillId = existing?.id

        if (!skillId) {
          const created = createSkillRecord(
            fallbackSkillName,
            fallbackResolution.category,
            fallbackResolution.action === 'assign_seed' ? 'seed' : 'manual',
          )
          skillId = created.id
          nextState = {
            ...nextState,
            skills: [created, ...nextState.skills],
          }
        }

        nextState = applySkillResolutionToCompletion({
          state: nextState,
          completionId,
          skillId,
          mode: quest.skillMappingMode,
          source: fallbackResolution.action === 'assign_seed' ? 'seed' : 'manual',
          reason: fallbackResolution.reason,
        })
      } else {
        const candidateSkillIds = fallbackResolution.candidateSkills
          .map((skillName) => skillName.trim())
          .filter((skillName) => skillName.length > 0)
          .map((skillName) => {
            const existing = nextState.skills.find(
              (skill) => normalizeSkillName(skill.name) === normalizeSkillName(skillName),
            )
            if (existing) {
              return existing.id
            }

            const created = createSkillRecord(skillName, fallbackResolution.category, 'seed')
            nextState = {
              ...nextState,
              skills: [created, ...nextState.skills],
            }
            return created.id
          })
          .slice(0, 3)

        nextState = reconcileState({
          ...nextState,
          completions: nextState.completions.map((completion) =>
            completion.id === completionId
              ? {
                  ...completion,
                  skillResolutionStatus:
                    quest.skillMappingMode === 'ask_each_time' || candidateSkillIds.length > 0
                      ? 'needs_confirmation'
                      : 'unclassified',
                  candidateSkillIds,
                  resolutionReason: fallbackResolution.reason,
                }
              : completion,
          ),
        })
      }
    } else {
      nextState = reconcileState(nextState)
    }

    const completion = nextState.completions.find((entry) => entry.id === completionId)
    if (!completion) {
      return { error: 'クエスト完了の保存に失敗しました。' }
    }

    const fallbackMessage = buildCompletionFallbackMessage(nextState, completion)
    nextState = reconcileState({
      ...nextState,
      assistantMessages: [fallbackMessage, ...nextState.assistantMessages].slice(0, 80),
      completions: nextState.completions.map((entry) =>
        entry.id === completion.id ? { ...entry, assistantMessageId: fallbackMessage.id } : entry,
      ),
    })

    persistState(nextState)
    set({
      ...nextState,
      busyQuestId: undefined,
      currentEffectCompletionId: completionId,
    })

    // バックグラウンドで個別APIにデータを同期
    void (async () => {
      try {
        const comp = nextState.completions.find((e) => e.id === completionId)
        if (comp) await api.postCompletion(comp).catch(() => undefined)
        await api.putUser(nextState.user).catch(() => undefined)
        // ワンタイムクエストの status 変更を同期
        if (quest.questType === 'one_time') {
          await api.putQuest(quest.id, { status: 'completed', updatedAt: nowIso() }).catch(() => undefined)
        }
        // 新しいスキルがあればPOST
        for (const skill of nextState.skills) {
          if (!state.skills.some((s) => s.id === skill.id)) {
            await api.postSkill(skill).catch(() => undefined)
          }
        }
      } catch { /* ignore */ }
    })()

    if (
      !completion.resolvedSkillId &&
      quest.privacyMode !== 'no_ai' &&
      hasUsableAi(nextState.aiConfig, nextState.settings)
    ) {
      void get().resolveCompletionCandidates(completionId)
    }

    if (hasUsableAi(nextState.aiConfig, nextState.settings)) {
      void (async () => {
        try {
          const messageResult = await generateLilyMessageWithProvider({
            aiConfig: get().aiConfig,
            settings: get().settings,
            payload: {
              intent: 'quest_completed',
              quest: {
                title: quest.title,
                xpReward: quest.xpReward,
              },
              skill: completion.resolvedSkillId
                ? get().skills.find((skill) =>
                    skill.id === resolveMergedSkillId(completion.resolvedSkillId, get().skills),
                  )?.name
                : undefined,
            },
          })

          const generatedMessage: AssistantMessage = {
            id: completion.assistantMessageId ?? createId('msg'),
            triggerType: messageResult.intent,
            mood: messageResult.mood,
            text: messageResult.text,
            completionId,
            createdAt: nowIso(),
          }

          const current = get()
          const updated = reconcileState({
            ...current,
            assistantMessages: [
              generatedMessage,
              ...current.assistantMessages.filter((message) => message.id !== generatedMessage.id),
            ].slice(0, 80),
            completions: current.completions.map((entry) =>
              entry.id === completionId ? { ...entry, assistantMessageId: generatedMessage.id } : entry,
            ),
          })
          persistState(updated)
          set(updated)
          void api.postMessage(generatedMessage).catch(() => undefined)

          if (messageResult.shouldSpeak && get().settings.lilyAutoPlay === 'on') {
            await get().playAssistantMessage(generatedMessage.id)
          }
        } catch {
          // AI failures never block core flow.
        }
      })()
    }

    scheduleNotification(fallbackMessage, nextState.settings)
    return { completionId }
  },

  resolveCompletionCandidates: async (completionId, result) => {
    const requestState = get()
    const requestCompletion = requestState.completions.find((entry) => entry.id === completionId)
    if (!requestCompletion || requestCompletion.undoneAt || requestCompletion.resolvedSkillId) {
      return
    }

    const requestQuest = requestState.quests.find((entry) => entry.id === requestCompletion.questId)
    if (!requestQuest) {
      return
    }

    const resolution =
      result ??
      (await resolveSkillWithProvider({
        aiConfig: requestState.aiConfig,
        settings: requestState.settings,
        quest: requestQuest,
        note: requestCompletion.note,
        skills: requestState.skills.filter((skill) => skill.status === 'active'),
        dictionary: requestState.personalSkillDictionary
          .map((entry) => {
            const skill = requestState.skills.find((item) => item.id === entry.mappedSkillId)
            return skill ? { phrase: entry.phrase, mappedSkillName: skill.name } : undefined
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      }))

    const latestState = get()
    const completion = latestState.completions.find((entry) => entry.id === completionId)
    if (!completion || completion.undoneAt || completion.resolvedSkillId) {
      return
    }

    const quest = latestState.quests.find((entry) => entry.id === completion.questId)
    if (!quest) {
      return
    }

    let nextState: PersistedAppState = toPersistedState(latestState)
    const maybeCreateSkill = (
      skillName: string,
      category: string,
      source: 'manual' | 'ai' | 'seed',
    ): string | undefined => {
      const normalizedSkillName = skillName.trim()
      if (!normalizedSkillName) {
        return undefined
      }

      const existing = nextState.skills.find(
        (skill) => skill.status === 'active' && normalizeSkillName(skill.name) === normalizeSkillName(normalizedSkillName),
      )
      if (existing) {
        return existing.id
      }

      const created = createSkillRecord(normalizedSkillName, category, source)
      nextState = {
        ...nextState,
        skills: [created, ...nextState.skills],
      }
      return created.id
    }

    if (resolution.confidence >= 0.8 && resolution.skillName !== '未分類') {
      const skillId = maybeCreateSkill(
        resolution.skillName,
        resolution.category,
        resolution.action === 'assign_seed' ? 'seed' : resolution.action === 'propose_new' ? 'ai' : 'manual',
      )
      if (skillId) {
        nextState = applySkillResolutionToCompletion({
          state: nextState,
          completionId,
          skillId,
          mode: quest.skillMappingMode,
          source:
            resolution.action === 'assign_seed' ? 'seed' : resolution.action === 'propose_new' ? 'ai' : 'manual',
          reason: resolution.reason,
        })
      } else {
        nextState = reconcileState({
          ...nextState,
          completions: nextState.completions.map((entry) =>
            entry.id === completionId
              ? {
                  ...entry,
                  skillResolutionStatus: 'unclassified',
                  resolutionReason: resolution.reason,
                }
              : entry,
          ),
        })
      }
    } else if (resolution.confidence >= 0.55) {
      const candidateSkillIds = resolution.candidateSkills
        .map((skillName) =>
          maybeCreateSkill(
            skillName,
            resolution.category,
            resolution.action === 'assign_seed' ? 'seed' : resolution.action === 'propose_new' ? 'ai' : 'manual',
          ),
        )
        .filter((skillId): skillId is string => Boolean(skillId))
        .slice(0, 3)

      nextState = reconcileState({
        ...nextState,
        completions: nextState.completions.map((entry) =>
          entry.id === completionId
            ? {
                ...entry,
                skillResolutionStatus: 'needs_confirmation',
                candidateSkillIds,
                resolutionReason: resolution.reason,
              }
            : entry,
        ),
      })
    } else {
      nextState = reconcileState({
        ...nextState,
        completions: nextState.completions.map((entry) =>
          entry.id === completionId
            ? {
                ...entry,
                skillResolutionStatus: 'unclassified',
                resolutionReason: resolution.reason,
              }
            : entry,
        ),
      })
    }

    persistState(nextState)
    set(nextState)
    // スキル解決結果をクラウドに同期
    void (async () => {
      const comp = nextState.completions.find((e) => e.id === completionId)
      if (comp) await api.putCompletion(completionId, comp).catch(() => undefined)
      for (const skill of nextState.skills) {
        if (!latestState.skills.some((s) => s.id === skill.id)) {
          await api.postSkill(skill).catch(() => undefined)
        }
      }
    })()
  },

  confirmCompletionSkill: (completionId, skillId) => {
    const state = get()
    const completion = state.completions.find((entry) => entry.id === completionId)
    const quest = completion ? state.quests.find((entry) => entry.id === completion.questId) : undefined
    const skill = state.skills.find((entry) => entry.id === skillId)
    if (!completion || !quest || !skill) {
      return
    }

    const nextState = applySkillResolutionToCompletion({
      state,
      completionId,
      skillId,
      mode: quest.skillMappingMode,
      source: 'manual',
      reason: 'ユーザー確認で確定',
    })
    persistState(nextState)
    set(nextState)
    const updatedComp = nextState.completions.find((e) => e.id === completionId)
    if (updatedComp) void api.putCompletion(completionId, updatedComp).catch(() => undefined)
  },

  undoCompletion: (completionId) => {
    const state = get()
    const completion = state.completions.find((entry) => entry.id === completionId)
    if (!completion) {
      return { ok: false, reason: '記録が見つかりません。' }
    }

    if (!isUndoable(completion.completedAt, completion.undoneAt)) {
      return { ok: false, reason: '取り消し可能な時間を過ぎています。' }
    }

    const nextState = reconcileState({
      ...state,
      completions: state.completions.map((entry) =>
        entry.id === completionId
          ? {
              ...entry,
              undoneAt: nowIso(),
            }
          : entry,
      ),
      quests: state.quests.map((entry) =>
        entry.id === completion.questId && entry.questType === 'one_time'
          ? {
              ...entry,
              status: 'active',
            }
          : entry,
      ),
    })

    persistState(nextState)
    set(nextState)
    void api.putCompletion(completionId, { undoneAt: nowIso() }).catch(() => undefined)
    const quest = state.quests.find((e) => e.id === completion.questId)
    if (quest?.questType === 'one_time') {
      void api.putQuest(quest.id, { status: 'active', updatedAt: nowIso() }).catch(() => undefined)
    }
    return { ok: true }
  },

  mergeSkills: (sourceSkillId, targetSkillId) => {
    const state = get()
    if (sourceSkillId === targetSkillId) {
      return { ok: false, reason: '同じスキル同士は統合できません。' }
    }

    const source = state.skills.find((skill) => skill.id === sourceSkillId)
    const target = state.skills.find((skill) => skill.id === targetSkillId)
    if (!source || !target) {
      return { ok: false, reason: 'スキルが見つかりません。' }
    }

    const nextState = reconcileState({
      ...state,
      skills: state.skills.map((skill) =>
        skill.id === sourceSkillId
          ? {
              ...skill,
              status: 'merged',
              mergedIntoSkillId: targetSkillId,
              updatedAt: nowIso(),
            }
          : skill,
      ),
      quests: state.quests.map((quest) => ({
        ...quest,
        fixedSkillId: quest.fixedSkillId === sourceSkillId ? targetSkillId : quest.fixedSkillId,
        defaultSkillId: quest.defaultSkillId === sourceSkillId ? targetSkillId : quest.defaultSkillId,
      })),
      completions: state.completions.map((completion) => ({
        ...completion,
        resolvedSkillId: completion.resolvedSkillId === sourceSkillId ? targetSkillId : completion.resolvedSkillId,
        candidateSkillIds: completion.candidateSkillIds?.map((id) => (id === sourceSkillId ? targetSkillId : id)),
      })),
      personalSkillDictionary: state.personalSkillDictionary.map((entry) => ({
        ...entry,
        mappedSkillId: entry.mappedSkillId === sourceSkillId ? targetSkillId : entry.mappedSkillId,
      })),
    })

    persistState(nextState)
    set(nextState)
    void (async () => {
      await api.putSkill(sourceSkillId, { status: 'merged', mergedIntoSkillId: targetSkillId, updatedAt: nowIso() }).catch(() => undefined)
      // 影響を受けたクエスト・完了記録・辞書も同期
      for (const quest of nextState.quests) {
        const orig = state.quests.find((q) => q.id === quest.id)
        if (orig?.fixedSkillId !== quest.fixedSkillId || orig?.defaultSkillId !== quest.defaultSkillId) {
          await api.putQuest(quest.id, quest).catch(() => undefined)
        }
      }
      for (const comp of nextState.completions) {
        const orig = state.completions.find((c) => c.id === comp.id)
        if (orig?.resolvedSkillId !== comp.resolvedSkillId) {
          await api.putCompletion(comp.id, comp).catch(() => undefined)
        }
      }
      for (const dict of nextState.personalSkillDictionary) {
        const orig = state.personalSkillDictionary.find((d) => d.id === dict.id)
        if (orig?.mappedSkillId !== dict.mappedSkillId) {
          await api.putDictEntry(dict.id, dict).catch(() => undefined)
        }
      }
    })()
    return { ok: true }
  },

  setSettings: (partial) => {
    const state = get()
    const nextState = reconcileState({
      ...state,
      settings: {
        ...state.settings,
        ...partial,
        updatedAt: nowIso(),
      },
    })
    persistState(nextState)
    set(nextState)
    void api.putSettings(nextState.settings).catch(() => undefined)

    if (partial.notificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        set((current) => ({
          meta: {
            ...current.meta,
            notificationPermission: permission,
          },
        }))
      })
    }
  },

  setAiConfig: (provider, patch) => {
    const state = get()
    const providerConfig = state.aiConfig.providers[provider]
    const nextState = reconcileState({
      ...state,
      aiConfig: {
        ...state.aiConfig,
        providers: {
          ...state.aiConfig.providers,
          [provider]: {
            ...providerConfig,
            ...patch,
            updatedAt: nowIso(),
          },
        },
      },
    })
    persistState(nextState)
    set(nextState)
    void api.putAiConfig(nextState.aiConfig).catch(() => undefined)
  },

  setActiveProvider: (provider) => {
    const state = get()
    const nextState = reconcileState({
      ...state,
      aiConfig: {
        ...state.aiConfig,
        activeProvider: provider,
      },
    })
    persistState(nextState)
    set(nextState)
    void api.putAiConfig(nextState.aiConfig).catch(() => undefined)
  },

  testConnection: async (provider) => {
    set((state) => ({
      connectionState: {
        ...state.connectionState,
        [provider]: {
          status: 'testing',
          message: '接続確認中...',
        },
      },
    }))

    try {
      await testProviderConnection(get().aiConfig, get().settings, provider)
      const state = get()
      const providerConfig = getProviderConfig(state.aiConfig, provider)
      const nextState = reconcileState({
        ...state,
        aiConfig: {
          ...state.aiConfig,
          providers: {
            ...state.aiConfig.providers,
            [provider]: {
              ...providerConfig!,
              status: 'verified',
              updatedAt: nowIso(),
            },
          },
        },
      })
      persistState(nextState)
      void api.putAiConfig(nextState.aiConfig).catch(() => undefined)
      set({
        ...nextState,
        connectionState: {
          ...get().connectionState,
          [provider]: {
            status: 'success',
            message: `接続に成功しました: ${maskApiKey(nextState.aiConfig.providers[provider].apiKey)}`,
          },
        },
      })
    } catch (error) {
      const state = get()
      const providerConfig = getProviderConfig(state.aiConfig, provider)
      const nextProviderStatus =
        error instanceof OfflineFeatureError ? providerConfig?.status ?? 'unverified' : 'invalid'
      const nextState = reconcileState({
        ...state,
        aiConfig: {
          ...state.aiConfig,
          providers: {
            ...state.aiConfig.providers,
            [provider]: {
              ...providerConfig!,
              status: nextProviderStatus,
              updatedAt: nowIso(),
            },
          },
        },
      })
      persistState(nextState)
      void api.putAiConfig(nextState.aiConfig).catch(() => undefined)
      set({
        ...nextState,
        connectionState: {
          ...get().connectionState,
          [provider]: {
            status: 'error',
            message: error instanceof Error ? error.message : '接続確認に失敗しました。',
          },
        },
      })
    }
  },

  playAssistantMessage: async (messageId) => {
    const state = get()
    const message = state.assistantMessages.find((entry) => entry.id === messageId)
    if (!message) {
      return '音声メッセージが見つかりません。'
    }

    if (isOffline()) {
      return getOfflineMessage('音声再生')
    }

    const cachedAudio = getCachedAudio(message.id)
    if (cachedAudio) {
      try {
        await playAudioUrl(message.id, cachedAudio)
        return
      } catch {
        // Fall through to fresh generation.
      }
    }

    try {
      const url = await generateTtsAudio({
        aiConfig: state.aiConfig,
        settings: state.settings,
        text: message.text,
      })
      await playAudioUrl(message.id, url)
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : '音声再生に失敗しました。'
    }
  },

  exportData: () => {
    const state = get()
    const payload = prepareExportPayload(state)
    downloadJson(`self-growth-export-${getDayKey(new Date())}.json`, payload)
  },

  importData: (jsonText, mode) => {
    try {
      const raw = JSON.parse(jsonText) as unknown
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, reason: 'インポートデータはオブジェクト形式である必要があります。' }
      }

      const data = raw as Record<string, unknown>
      for (const key of ['quests', 'completions', 'skills', 'personalSkillDictionary', 'assistantMessages'] as const) {
        if (key in data && !Array.isArray(data[key])) {
          return { ok: false, reason: `"${key}" は配列である必要があります。` }
        }
      }

      const parsed = data as Partial<PersistedAppState>
      const merged = mergeImportedState(get(), parsed, mode)
      persistState(merged)
      set(merged)
      // インポートデータをクラウドに同期
      void (async () => {
        await api.putUser(merged.user).catch(() => undefined)
        await api.putSettings(merged.settings).catch(() => undefined)
        await api.putAiConfig(merged.aiConfig).catch(() => undefined)
        await api.putMeta(merged.meta).catch(() => undefined)
        for (const q of merged.quests) await api.postQuest(q).catch(() => undefined)
        for (const c of merged.completions) await api.postCompletion(c).catch(() => undefined)
        for (const s of merged.skills) await api.postSkill(s).catch(() => undefined)
        for (const m of merged.assistantMessages) await api.postMessage(m).catch(() => undefined)
        for (const d of merged.personalSkillDictionary) await api.postDictEntry(d).catch(() => undefined)
      })()
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'JSON の読み込みに失敗しました。',
      }
    }
  },

  resetLocalData: () => {
    clearPersistedState()
    const reset = hydratePersistedState()
    persistState(reset)
    set({
      ...reset,
      hydrated: true,
      currentEffectCompletionId: undefined,
      connectionState: {
        openai: { status: 'idle' },
        gemini: { status: 'idle' },
      },
    })
  },

  setImportMode: (mode) => {
    set({ importMode: mode })
  },
}))

export const appHelpers = {
  currentWeekKey: () => getWeekKey(new Date()),
}
