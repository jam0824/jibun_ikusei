import type {
  LocalUser,
  UserSettings,
  Quest,
  QuestCompletion,
  Skill,
} from '@/domain/types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${path}`)
  }
  return res.json() as Promise<T>
}

// ユーザー
export function getUser() {
  return request<LocalUser>('/user')
}

// クエスト
export function getQuests() {
  return request<Quest[]>('/quests')
}

export function postQuest(quest: Omit<Quest, 'createdAt' | 'updatedAt'>) {
  return request<Quest>('/quests', {
    method: 'POST',
    body: JSON.stringify(quest),
  })
}

export function putQuest(id: string, quest: Partial<Quest>) {
  return request<Quest>(`/quests/${id}`, {
    method: 'PUT',
    body: JSON.stringify(quest),
  })
}

export function deleteQuest(id: string) {
  return request<{ deleted: string }>(`/quests/${id}`, {
    method: 'DELETE',
  })
}

// 完了記録
export function getCompletions() {
  return request<QuestCompletion[]>('/completions')
}

export function postCompletion(payload: { questId: string; note?: string; source?: string }) {
  return request<{
    completionId: string
    xpAwarded: number
    totalXp: number
    level: number
    levelUp: boolean
  }>('/completions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteCompletion(id: string) {
  return request<{ deleted: string }>(`/completions/${id}`, {
    method: 'DELETE',
  })
}

// スキル
export function getSkills() {
  return request<Skill[]>('/skills')
}

// 設定
export function getSettings() {
  return request<UserSettings>('/settings')
}

export function putSettings(settings: Partial<UserSettings>) {
  return request<{ updated: boolean }>('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}
