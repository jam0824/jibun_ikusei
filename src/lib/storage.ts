import type { PersistedAppState } from '@/domain/types'
import { reconcileState } from '@/domain/logic'
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

/** IDを持つ配列をマージ。同じIDは updatedAt が新しい方を採用、それ以外はユニオン */
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

function mergeStates(local: PersistedAppState, cloud: Partial<PersistedAppState>): PersistedAppState {
  const merged: PersistedAppState = {
    user: local.user,
    settings: (cloud.settings?.updatedAt ?? '') > local.settings.updatedAt
      ? cloud.settings!
      : local.settings,
    aiConfig: local.aiConfig,
    quests: mergeArrayById(local.quests, cloud.quests ?? []),
    completions: mergeArrayById(local.completions, cloud.completions ?? []),
    skills: mergeArrayById(local.skills, cloud.skills ?? []),
    personalSkillDictionary: mergeArrayById(
      local.personalSkillDictionary,
      cloud.personalSkillDictionary ?? [],
    ),
    assistantMessages: mergeArrayById(local.assistantMessages, cloud.assistantMessages ?? []),
    meta: local.meta,
  }
  // completionsのマージでXP/レベルが変わる可能性があるので再計算
  return reconcileState(merged)
}

async function putToCloud(state: PersistedAppState, token: string): Promise<void> {
  await fetch(`${API_BASE_URL}/sync`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(state),
  })
}

async function syncToCloud(state: PersistedAppState): Promise<void> {
  if (!API_BASE_URL) return
  const token = await getIdToken()
  if (!token) return

  // クラウドの最新状態を取得してマージしてからPUT
  try {
    const res = await fetch(`${API_BASE_URL}/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const cloud = await res.json() as Partial<PersistedAppState> | null
      if (cloud) {
        const merged = mergeStates(state, cloud)
        await putToCloud(merged, token)
        return
      }
    }
  } catch {
    // GETに失敗した場合はそのままPUT
  }
  await putToCloud(state, token)
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
