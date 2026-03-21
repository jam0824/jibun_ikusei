import type { PersistedAppState } from '@/domain/types'
import { STORAGE_KEYS } from '@/domain/constants'
import { safeJsonParse } from '@/lib/utils'
import { getIdToken } from '@/lib/auth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined

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
  window.localStorage.setItem(
    STORAGE_KEYS.personalSkillDictionary,
    JSON.stringify(state.personalSkillDictionary),
  )
  window.localStorage.setItem(STORAGE_KEYS.aiConfig, JSON.stringify(state.aiConfig))
  window.localStorage.setItem(STORAGE_KEYS.meta, JSON.stringify(state.meta))
}

async function syncToCloud(state: PersistedAppState): Promise<void> {
  if (!API_BASE_URL) return
  const token = await getIdToken()
  if (!token) return
  await fetch(`${API_BASE_URL}/sync`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(state),
  })
}

export async function loadFromCloud(): Promise<Partial<PersistedAppState> | null> {
  if (!API_BASE_URL) return null
  const token = await getIdToken()
  if (!token) return null
  try {
    const res = await fetch(`${API_BASE_URL}/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const data = await res.json() as Partial<PersistedAppState> | null
    return data
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


export function persistState(state: PersistedAppState) {
  if (typeof window === 'undefined') {
    return
  }
  saveToLocalStorage(state)
  // バックグラウンドでクラウドに同期（失敗してもアプリに影響しない）
  void syncToCloud(state).catch(() => undefined)
}

export function clearPersistedState() {
  if (typeof window === 'undefined') {
    return
  }
  Object.values(STORAGE_KEYS).forEach((key) => window.localStorage.removeItem(key))
}
