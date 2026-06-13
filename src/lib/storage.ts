import type { PersistedAppState } from '@/domain/types'
import { hydratePersistedState, reconcileState } from '@/domain/logic'
import { STORAGE_KEYS } from '@/domain/constants'
import { safeJsonParse } from '@/lib/utils'
import {
  getUser,
  getQuests,
  getCompletions,
  getSkills,
  getSettings,
  getAiConfig,
  getMeta,
  getMessages,
  getDictionary,
  getScraps,
} from '@/lib/api-client'

function loadFromLocalStorage(): Partial<PersistedAppState> {
  return {
    user: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.user), undefined),
    settings: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.settings), undefined),
    quests: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.quests), []),
    completions: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.completions), []),
    skills: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.skills), []),
    assistantMessages: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.assistantMessages), []),
    personalSkillDictionary: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.personalSkillDictionary), []),
    aiConfig: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.aiConfig), undefined),
    scrapArticles: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.scrapArticles), []),
    meta: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.meta), undefined),
  }
}

function saveToLocalStorage(state: PersistedAppState) {
  window.localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(state.user))
  window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings))
  window.localStorage.setItem(STORAGE_KEYS.quests, JSON.stringify(state.quests))
  window.localStorage.setItem(STORAGE_KEYS.completions, JSON.stringify(state.completions))
  window.localStorage.setItem(STORAGE_KEYS.skills, JSON.stringify(state.skills))
  window.localStorage.setItem(STORAGE_KEYS.assistantMessages, JSON.stringify(state.assistantMessages))
  window.localStorage.setItem(STORAGE_KEYS.scrapArticles, JSON.stringify(state.scrapArticles))
  window.localStorage.setItem(
    STORAGE_KEYS.personalSkillDictionary,
    JSON.stringify(state.personalSkillDictionary),
  )
  window.localStorage.setItem(STORAGE_KEYS.aiConfig, JSON.stringify(state.aiConfig))
  window.localStorage.setItem(STORAGE_KEYS.meta, JSON.stringify(state.meta))
}

/** 個別APIからクラウドデータを並行取得して結合 */
export async function loadFromCloud(): Promise<Partial<PersistedAppState> | null> {
  try {
    const [user, quests, completions, skills, settings, aiConfig, meta, messages, dictionary, scrapArticles] =
      await Promise.all([
        getUser().catch(() => null),
        getQuests().catch(() => []),
        getCompletions().catch(() => []),
        getSkills().catch(() => []),
        getSettings().catch(() => null),
        getAiConfig().catch(() => null),
        getMeta().catch(() => null),
        getMessages().catch(() => []),
        getDictionary().catch(() => []),
        getScraps().catch(() => []),
      ])

    // 全てnull/空なら未保存と判断
    if (!user && !settings && quests.length === 0 && scrapArticles.length === 0) return null

    return reconcileState(hydratePersistedState({
      user: user ?? undefined,
      settings: settings ?? undefined,
      aiConfig: aiConfig ?? undefined,
      quests,
      completions,
      skills,
      personalSkillDictionary: dictionary,
      assistantMessages: messages,
      scrapArticles,
      meta: meta ?? undefined,
    }))
  } catch {
    return null
  }
}

export function loadPersistedState(): Partial<PersistedAppState> {
  if (typeof window === 'undefined') {
    return {}
  }
  return loadFromLocalStorage()
}

/** localStorage にのみ保存（クラウド同期は各アクションが個別APIで行う） */
export function persistState(state: PersistedAppState) {
  if (typeof window === 'undefined') {
    return
  }
  saveToLocalStorage(state)
}

export function clearPersistedState() {
  if (typeof window === 'undefined') {
    return
  }
  Object.values(STORAGE_KEYS).forEach((key) => window.localStorage.removeItem(key))
}
