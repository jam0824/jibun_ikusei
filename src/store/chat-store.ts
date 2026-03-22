import { create } from 'zustand'
import type { ChatMessage, ChatSession } from '@/domain/types'
import { createId, safeJsonParse } from '@/lib/utils'
import { nowIso, getDayKey } from '@/lib/date'
import { subDays } from 'date-fns'
import { isOffline } from '@/lib/network'
import { buildLilyChatSystemPrompt, sendLilyChatMessage } from '@/lib/ai'
import { logActivity } from '@/lib/activity-logger'
import { useAppStore } from '@/store/app-store'
import * as api from '@/lib/api-client'

const SESSIONS_KEY = 'app.chatSessions'
const messagesKey = (sessionId: string) => `app.chatMessages.${sessionId}`

function loadSessions(): ChatSession[] {
  return safeJsonParse<ChatSession[]>(localStorage.getItem(SESSIONS_KEY), [])
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

function sortByCreatedAt(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
}

function loadMessages(sessionId: string): ChatMessage[] {
  return sortByCreatedAt(safeJsonParse<ChatMessage[]>(localStorage.getItem(messagesKey(sessionId)), []))
}

function saveMessages(sessionId: string, messages: ChatMessage[]) {
  localStorage.setItem(messagesKey(sessionId), JSON.stringify(messages))
}

function removeMessages(sessionId: string) {
  localStorage.removeItem(messagesKey(sessionId))
}

interface ChatStore {
  sessions: ChatSession[]
  currentSessionId: string | null
  currentMessages: ChatMessage[]
  isLoading: boolean
  isSending: boolean
  error: string | null

  initialize: () => Promise<void>
  createSession: () => Promise<string>
  selectSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  clearError: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  currentMessages: [],
  isLoading: false,
  isSending: false,
  error: null,

  initialize: async () => {
    const sessions = loadSessions()
    set({ sessions })

    // Sync from cloud in background
    try {
      const cloudSessions = await api.getChatSessions()
      saveSessions(cloudSessions)
      set({ sessions: cloudSessions })
    } catch {
      // Use local data on failure
    }
  },

  createSession: async () => {
    const id = createId('chat')
    const now = nowIso()
    const session: ChatSession = {
      id,
      title: '新しい会話',
      createdAt: now,
      updatedAt: now,
    }

    const next = [session, ...get().sessions]
    saveSessions(next)
    saveMessages(id, [])
    set({ sessions: next, currentSessionId: id, currentMessages: [] })

    api.postChatSession(session).catch(() => undefined)
    return id
  },

  selectSession: async (sessionId: string) => {
    set({ isLoading: true, currentSessionId: sessionId, error: null })

    // Load from local first
    const localMessages = loadMessages(sessionId)
    set({ currentMessages: localMessages })

    // Then sync from cloud
    try {
      const cloudMessages = sortByCreatedAt(await api.getChatMessages(sessionId))
      saveMessages(sessionId, cloudMessages)
      set({ currentMessages: cloudMessages, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  deleteSession: async (sessionId: string) => {
    const next = get().sessions.filter((s) => s.id !== sessionId)
    saveSessions(next)
    removeMessages(sessionId)

    const updates: Partial<ChatStore> = { sessions: next }
    if (get().currentSessionId === sessionId) {
      updates.currentSessionId = null
      updates.currentMessages = []
    }
    set(updates as ChatStore)

    api.deleteChatSession(sessionId).catch(() => undefined)
  },

  sendMessage: async (content: string) => {
    const { currentSessionId, currentMessages, sessions } = get()
    if (!currentSessionId) return

    const appState = useAppStore.getState()
    const openaiKey = appState.aiConfig.providers.openai.apiKey
    if (!openaiKey) {
      set({ error: 'OpenAI APIキーが設定されていません。設定画面から設定してください。' })
      return
    }

    if (isOffline()) {
      set({ error: 'オフラインのためリリィと会話できません。' })
      return
    }

    // Add user message optimistically
    const userMessage: ChatMessage = {
      id: createId('cmsg'),
      sessionId: currentSessionId,
      role: 'user',
      content,
      createdAt: nowIso(),
    }
    const updatedMessages = [...currentMessages, userMessage]
    saveMessages(currentSessionId, updatedMessages)
    set({ currentMessages: updatedMessages, isSending: true, error: null })

    api.postChatMessage(currentSessionId, userMessage).catch(() => undefined)

    try {
      // Fetch activity logs for context (last 7 days)
      const now = new Date()
      const from = getDayKey(subDays(now, 7))
      const to = getDayKey(now)
      let activityLogs: api.ActivityLogEntry[] = []
      try {
        activityLogs = await api.getActivityLogs(from, to)
      } catch {
        // Continue without logs
      }

      // Build recent completions with quest titles
      const recentCompletions = appState.completions
        .filter((c) => !c.undoneAt && c.completedAt >= from)
        .slice(0, 10)
        .map((c) => ({
          questTitle: appState.quests.find((q) => q.id === c.questId)?.title ?? '不明なクエスト',
          completedAt: c.completedAt,
        }))

      // Build system prompt
      const systemPrompt = buildLilyChatSystemPrompt({
        user: appState.user,
        skills: appState.skills,
        quests: appState.quests,
        recentCompletions,
        activityLogs,
      })

      // Build messages array for API
      const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...updatedMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ]

      const responseText = await sendLilyChatMessage({
        apiKey: openaiKey,
        messages: apiMessages,
      })

      // Add assistant response
      const assistantMessage: ChatMessage = {
        id: createId('cmsg'),
        sessionId: currentSessionId,
        role: 'assistant',
        content: responseText,
        createdAt: nowIso(),
      }
      const finalMessages = [...updatedMessages, assistantMessage]
      saveMessages(currentSessionId, finalMessages)
      set({ currentMessages: finalMessages, isSending: false })

      api.postChatMessage(currentSessionId, assistantMessage).catch(() => undefined)

      // Update session title if first message
      const isFirstMessage = updatedMessages.filter((m) => m.role === 'user').length === 1
      if (isFirstMessage) {
        const title = content.slice(0, 30)
        const now = nowIso()
        const updatedSessions = sessions.map((s) =>
          s.id === currentSessionId ? { ...s, title, updatedAt: now } : s,
        )
        saveSessions(updatedSessions)
        set({ sessions: updatedSessions })
        api.putChatSession(currentSessionId, { title, updatedAt: now }).catch(() => undefined)
      } else {
        // Update session updatedAt
        const now = nowIso()
        const updatedSessions = sessions.map((s) =>
          s.id === currentSessionId ? { ...s, updatedAt: now } : s,
        )
        saveSessions(updatedSessions)
        set({ sessions: updatedSessions })
        api.putChatSession(currentSessionId, { updatedAt: now }).catch(() => undefined)
      }
    } catch (err) {
      logActivity('chat.error', 'error', { context: 'lily.chat.send', message: err instanceof Error ? err.message : String(err) })
      const message = err instanceof Error ? err.message : 'リリィからの応答に失敗しました。'
      set({ isSending: false, error: message })
    }
  },

  clearError: () => set({ error: null }),
}))
