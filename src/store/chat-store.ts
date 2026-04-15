import { create } from 'zustand'
import type { ChatMessage, ChatSession } from '@/domain/types'
import { createId, safeJsonParse } from '@/lib/utils'
import { nowIso, getDayKey } from '@/lib/date'
import { subDays, startOfDay } from 'date-fns'
import { isOffline } from '@/lib/network'
import { buildLilyChatSystemPrompt, sendLilyChatMessage } from '@/lib/ai'
import type { ChatMessageParam } from '@/lib/ai'
import { CHAT_TOOLS, executeTool } from '@/lib/chat-tools'
import type { ToolContext } from '@/lib/chat-tools'
import { logActivity } from '@/lib/activity-logger'
import { useAppStore } from '@/store/app-store'
import * as api from '@/lib/api-client'

const SESSIONS_KEY = 'app.chatSessions'
const messagesKey = (sessionId: string) => `app.chatMessages.${sessionId}`

function sortSessionsByUpdatedAt(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

function loadSessions(): ChatSession[] {
  return sortSessionsByUpdatedAt(
    safeJsonParse<ChatSession[]>(localStorage.getItem(SESSIONS_KEY), []),
  )
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sortSessionsByUpdatedAt(sessions)))
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

function getLatestSession(sessions: ChatSession[]): ChatSession | null {
  return sessions[0] ?? null
}

function toApiConversationMessage(message: ChatMessage): ChatMessageParam {
  if (message.role === 'system') {
    return {
      role: 'user',
      content: `[システム通知] ${message.content}`,
    }
  }

  return {
    role: message.role,
    content: message.content,
  }
}

function updateSessionList(
  sessions: ChatSession[],
  sessionId: string,
  updates: Partial<ChatSession>,
): ChatSession[] {
  return sortSessionsByUpdatedAt(
    sessions.map((session) =>
      session.id === sessionId ? { ...session, ...updates } : session,
    ),
  )
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
    const localSessions = loadSessions()
    const localLatestSession = getLatestSession(localSessions)
    const localLatestSessionId = localLatestSession?.id ?? null

    set({
      sessions: localSessions,
      currentSessionId: localLatestSessionId,
      currentMessages: localLatestSession ? loadMessages(localLatestSession.id) : [],
      isLoading: false,
      error: null,
    })

    // Sync from cloud in background
    try {
      const cloudSessions = sortSessionsByUpdatedAt(await api.getChatSessions())
      const cloudLatestSession = getLatestSession(cloudSessions)
      const cloudLatestSessionId = cloudLatestSession?.id ?? null
      saveSessions(cloudSessions)

      if (!cloudLatestSession) {
        set({
          sessions: cloudSessions,
          currentSessionId: null,
          currentMessages: [],
          isLoading: false,
        })
        return
      }

      const currentSessionId = get().currentSessionId
      const shouldSwitchToLatest =
        currentSessionId === null ||
        currentSessionId === localLatestSessionId ||
        cloudLatestSessionId !== localLatestSessionId

      if (!shouldSwitchToLatest) {
        set({ sessions: cloudSessions })
        return
      }

      set((state) => ({
        sessions: cloudSessions,
        currentSessionId: cloudLatestSession.id,
        currentMessages:
          state.currentSessionId === cloudLatestSession.id
            ? state.currentMessages
            : loadMessages(cloudLatestSession.id),
        isLoading: true,
        error: null,
      }))

      try {
        const cloudMessages = sortByCreatedAt(await api.getChatMessages(cloudLatestSession.id))
        saveMessages(cloudLatestSession.id, cloudMessages)
        set((state) =>
          state.currentSessionId === cloudLatestSession.id
            ? { currentMessages: cloudMessages, isLoading: false }
            : { isLoading: false },
        )
      } catch {
        set({ isLoading: false })
      }
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

    const next = sortSessionsByUpdatedAt([session, ...get().sessions])
    saveSessions(next)
    saveMessages(id, [])
    set({ sessions: next, currentSessionId: id, currentMessages: [] })

    api.postChatSession(session).catch(() => undefined)
    return id
  },

  selectSession: async (sessionId: string) => {
    const localMessages = loadMessages(sessionId)
    set({
      isLoading: true,
      currentSessionId: sessionId,
      currentMessages: localMessages,
      error: null,
    })

    // Then sync from cloud
    try {
      const cloudMessages = sortByCreatedAt(await api.getChatMessages(sessionId))
      saveMessages(sessionId, cloudMessages)
      set((state) =>
        state.currentSessionId === sessionId
          ? { currentMessages: cloudMessages, isLoading: false }
          : { isLoading: false },
      )
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
    const { currentSessionId, currentMessages } = get()
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
      const fromIso = startOfDay(subDays(now, 7)).toISOString()
      const recentCompletions = appState.completions
        .filter((c) => !c.undoneAt && c.completedAt >= fromIso)
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
      const apiMessages: ChatMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...updatedMessages.map(toApiConversationMessage),
      ]

      let result = await sendLilyChatMessage({
        apiKey: openaiKey,
        messages: apiMessages,
        tools: CHAT_TOOLS,
      })

      // Handle tool calls (max 1 round)
      if (result.type === 'tool_calls') {
        apiMessages.push(result.assistantMessage)

        const toolContext: ToolContext = {
          appState: useAppStore.getState(),
          chatSessions: get().sessions,
          chatMessages: get().currentMessages,
        }

        for (const toolCall of result.toolCalls) {
          let toolResult: string
          try {
            const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
            toolResult = await executeTool(toolCall.function.name, args, toolContext)
          } catch {
            toolResult = 'ツールの実行に失敗しました。'
          }
          apiMessages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: toolCall.id,
          })
        }

        result = await sendLilyChatMessage({
          apiKey: openaiKey,
          messages: apiMessages,
        })
      }

      const responseText = result.type === 'text' ? result.content : 'リリィからの応答を取得できませんでした。'

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

      const isFirstMessage = updatedMessages.filter((m) => m.role === 'user').length === 1
      const sessionUpdatedAt = nowIso()
      const sessionUpdates = isFirstMessage
        ? { title: content.slice(0, 30), updatedAt: sessionUpdatedAt }
        : { updatedAt: sessionUpdatedAt }
      const updatedSessions = updateSessionList(get().sessions, currentSessionId, sessionUpdates)
      saveSessions(updatedSessions)
      set({ sessions: updatedSessions })
      api.putChatSession(currentSessionId, sessionUpdates).catch(() => undefined)
    } catch (err) {
      logActivity('chat.error', 'error', { context: 'lily.chat.send', message: err instanceof Error ? err.message : String(err) })
      const message = err instanceof Error ? err.message : 'リリィからの応答に失敗しました。'
      set({ isSending: false, error: message })
    }
  },

  clearError: () => set({ error: null }),
}))
