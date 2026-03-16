import type { PersistedAppState } from '@/domain/types'
import { STORAGE_KEYS } from '@/domain/constants'
import { safeJsonParse } from '@/lib/utils'

export function loadPersistedState(): Partial<PersistedAppState> {
  if (typeof window === 'undefined') {
    return {}
  }

  return {
    user: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.user), undefined),
    settings: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.settings), undefined),
    quests: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.quests), []),
    completions: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.completions), []),
    skills: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.skills), []),
    assistantMessages: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.assistantMessages), []),
    personalSkillDictionary: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.personalSkillDictionary), []),
    aiConfig: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.aiConfig), undefined),
    meta: safeJsonParse(window.localStorage.getItem(STORAGE_KEYS.meta), undefined),
  }
}

export function persistState(state: PersistedAppState) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(state.user))
  window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings))
  window.localStorage.setItem(STORAGE_KEYS.quests, JSON.stringify(state.quests))
  window.localStorage.setItem(STORAGE_KEYS.completions, JSON.stringify(state.completions))
  window.localStorage.setItem(STORAGE_KEYS.skills, JSON.stringify(state.skills))
  window.localStorage.setItem(STORAGE_KEYS.assistantMessages, JSON.stringify(state.assistantMessages))
  window.localStorage.setItem(
    STORAGE_KEYS.personalSkillDictionary,
    JSON.stringify(state.personalSkillDictionary),
  )
  window.localStorage.setItem(STORAGE_KEYS.aiConfig, JSON.stringify(state.aiConfig))
  window.localStorage.setItem(STORAGE_KEYS.meta, JSON.stringify(state.meta))
}

export function clearPersistedState() {
  if (typeof window === 'undefined') {
    return
  }

  Object.values(STORAGE_KEYS).forEach((key) => window.localStorage.removeItem(key))
}
