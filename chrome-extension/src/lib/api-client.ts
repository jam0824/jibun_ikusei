import { getLocal } from '@ext/lib/storage'
import { getStoredToken } from '@ext/lib/auth'
import type { ExtensionSettings } from '@ext/types/settings'

async function getBaseUrl(): Promise<string> {
  const settings = await getLocal<ExtensionSettings>('extensionSettings')
  return settings?.serverBaseUrl ?? ''
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = await getBaseUrl()
  const token = await getStoredToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${baseUrl}${path}`, { headers, ...options })
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${path}`)
  }
  return res.json() as Promise<T>
}

export function createApiClient() {
  return {
    getUser() {
      return request<Record<string, unknown>>('/user')
    },
    putUser(data: Record<string, unknown>) {
      return request<{ updated: boolean }>('/user', {
        method: 'PUT',
        body: JSON.stringify(data),
      })
    },
    getCompletions() {
      return request<unknown[]>('/completions')
    },
    postQuest(data: Record<string, unknown>) {
      return request<Record<string, unknown>>('/quests', {
        method: 'POST',
        body: JSON.stringify(data),
      })
    },
    postCompletion(data: Record<string, unknown>) {
      return request<Record<string, unknown>>('/completions', {
        method: 'POST',
        body: JSON.stringify(data),
      })
    },
  }
}
