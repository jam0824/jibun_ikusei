import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatSession } from '@/domain/types'
import * as apiClient from '@/lib/api-client'
import { useChatStore } from '@/store/chat-store'
import { useAppStore } from '@/store/app-store'

vi.mock('@/lib/api-client', () => ({
  getChatSessions: vi.fn(),
  postChatSession: vi.fn(),
  putChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  getChatMessages: vi.fn(),
  postChatMessage: vi.fn(),
  getActivityLogs: vi.fn(),
}))

vi.mock('@/lib/ai', () => ({
  buildLilyChatSystemPrompt: vi.fn().mockReturnValue('system prompt'),
  sendLilyChatMessage: vi.fn().mockResolvedValue({ type: 'text', content: 'assistant reply' }),
}))

vi.mock('@/lib/chat-tools', () => ({
  CHAT_TOOLS: [],
  executeTool: vi.fn().mockResolvedValue('tool result'),
}))

vi.mock('@/store/app-store', () => ({
  useAppStore: {
    getState: vi.fn(),
  },
}))

const SESSIONS_KEY = 'app.chatSessions'
const NEW_CHAT_TITLE = '\u65b0\u3057\u3044\u4f1a\u8a71'
const OPENAI_KEY_LABEL = 'OpenAI API\u30ad\u30fc'

const messagesKey = (sessionId: string) => `app.chatMessages.${sessionId}`

function createDefaultAppState() {
  return {
    user: { id: 'local_user', level: 3, totalXp: 50, createdAt: '', updatedAt: '' },
    skills: [],
    completions: [],
    quests: [],
    aiConfig: {
      activeProvider: 'openai' as const,
      providers: {
        openai: { apiKey: 'sk-test', model: 'gpt-5.4', updatedAt: '' },
        gemini: { model: '', updatedAt: '' },
      },
    },
  }
}

function makeSession(overrides: Partial<ChatSession> & Pick<ChatSession, 'id'>): ChatSession {
  return {
    id: overrides.id,
    title: 'Session',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeMessage(
  overrides: Partial<ChatMessage> &
    Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content'>,
): ChatMessage {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId,
    role: overrides.role,
    content: overrides.content,
    createdAt: '2000-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function seedSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

function seedMessages(sessionId: string, messages: ChatMessage[]) {
  localStorage.setItem(messagesKey(sessionId), JSON.stringify(messages))
}

describe('chat store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()

    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      currentMessages: [],
      isLoading: false,
      isSending: false,
      error: null,
    })

    vi.mocked(apiClient.getChatSessions).mockResolvedValue([])
    vi.mocked(apiClient.postChatSession).mockResolvedValue({})
    vi.mocked(apiClient.putChatSession).mockResolvedValue({})
    vi.mocked(apiClient.deleteChatSession).mockResolvedValue({})
    vi.mocked(apiClient.getChatMessages).mockResolvedValue([])
    vi.mocked(apiClient.postChatMessage).mockResolvedValue({})
    vi.mocked(apiClient.getActivityLogs).mockResolvedValue([])
    vi.mocked(useAppStore.getState).mockReturnValue(
      createDefaultAppState() as ReturnType<typeof useAppStore.getState>,
    )
  })

  it('creates a new session and selects it', async () => {
    const sessionId = await useChatStore.getState().createSession()

    expect(sessionId).toMatch(/^chat_/)
    expect(useChatStore.getState().sessions).toHaveLength(1)
    expect(useChatStore.getState().currentSessionId).toBe(sessionId)
    expect(useChatStore.getState().sessions[0].title).toBe(NEW_CHAT_TITLE)
  })

  it('loads cloud messages when selecting a session', async () => {
    const cloudMessages = [
      makeMessage({
        id: 'cmsg_1',
        sessionId: 'chat_test',
        role: 'user',
        content: 'cloud message',
      }),
    ]
    vi.mocked(apiClient.getChatMessages).mockResolvedValueOnce(cloudMessages)

    const sessionId = await useChatStore.getState().createSession()
    await useChatStore.getState().selectSession(sessionId)

    expect(useChatStore.getState().currentSessionId).toBe(sessionId)
    expect(useChatStore.getState().currentMessages).toEqual(cloudMessages)
  })

  it('shows the latest local session immediately on initialize even if storage order is stale', async () => {
    const older = makeSession({
      id: 'chat_old',
      title: 'Old',
      updatedAt: '2000-01-01T00:00:00.000Z',
    })
    const latest = makeSession({
      id: 'chat_latest',
      title: 'Latest',
      updatedAt: '2000-01-02T00:00:00.000Z',
    })
    const localLatestMessages = [
      makeMessage({
        id: 'cmsg_local_latest',
        sessionId: latest.id,
        role: 'assistant',
        content: 'latest local message',
      }),
    ]

    let resolveCloudSessions: ((value: ChatSession[]) => void) | undefined
    vi.mocked(apiClient.getChatSessions).mockReturnValueOnce(
      new Promise<ChatSession[]>((resolve) => {
        resolveCloudSessions = resolve
      }),
    )
    vi.mocked(apiClient.getChatMessages).mockResolvedValueOnce(localLatestMessages)

    seedSessions([older, latest])
    seedMessages(latest.id, localLatestMessages)

    const initializePromise = useChatStore.getState().initialize()

    expect(useChatStore.getState().sessions.map((session) => session.id)).toEqual([
      latest.id,
      older.id,
    ])
    expect(useChatStore.getState().currentSessionId).toBe(latest.id)
    expect(useChatStore.getState().currentMessages).toEqual(localLatestMessages)

    resolveCloudSessions?.([older, latest])
    await initializePromise
  })

  it('switches to the latest cloud session after sync', async () => {
    const localLatest = makeSession({
      id: 'chat_local',
      title: 'Local latest',
      updatedAt: '2000-01-02T00:00:00.000Z',
    })
    const cloudLatest = makeSession({
      id: 'chat_cloud',
      title: 'Cloud latest',
      updatedAt: '2000-01-03T00:00:00.000Z',
    })
    const cloudMessages = [
      makeMessage({
        id: 'cmsg_cloud',
        sessionId: cloudLatest.id,
        role: 'assistant',
        content: 'latest cloud message',
      }),
    ]

    seedSessions([localLatest])
    seedMessages(
      localLatest.id,
      [
        makeMessage({
          id: 'cmsg_local',
          sessionId: localLatest.id,
          role: 'assistant',
          content: 'local message',
        }),
      ],
    )

    vi.mocked(apiClient.getChatSessions).mockResolvedValueOnce([localLatest, cloudLatest])
    vi.mocked(apiClient.getChatMessages).mockResolvedValueOnce(cloudMessages)

    await useChatStore.getState().initialize()

    expect(useChatStore.getState().sessions.map((session) => session.id)).toEqual([
      cloudLatest.id,
      localLatest.id,
    ])
    expect(useChatStore.getState().currentSessionId).toBe(cloudLatest.id)
    expect(useChatStore.getState().currentMessages).toEqual(cloudMessages)
  })

  it('deletes a session and clears the selection when needed', async () => {
    const sessionId = await useChatStore.getState().createSession()

    await useChatStore.getState().deleteSession(sessionId)

    expect(useChatStore.getState().sessions).toHaveLength(0)
    expect(useChatStore.getState().currentSessionId).toBeNull()
  })

  it('adds both user and assistant messages when sending', async () => {
    await useChatStore.getState().createSession()

    await useChatStore.getState().sendMessage('hello')

    const messages = useChatStore.getState().currentMessages
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('hello')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('assistant reply')
  })

  it('moves an older session to the top after sending a new message', async () => {
    const latest = makeSession({
      id: 'chat_latest',
      title: 'Latest session',
      updatedAt: '2000-01-02T00:00:00.000Z',
    })
    const older = makeSession({
      id: 'chat_old',
      title: NEW_CHAT_TITLE,
      updatedAt: '2000-01-01T00:00:00.000Z',
    })
    const firstUserMessage = 'This older session should move to the top after sending'

    seedSessions([latest, older])
    useChatStore.setState({
      sessions: [latest, older],
      currentSessionId: older.id,
      currentMessages: [],
      isLoading: false,
      isSending: false,
      error: null,
    })

    await useChatStore.getState().sendMessage(firstUserMessage)

    const state = useChatStore.getState()
    const savedSessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '[]') as ChatSession[]

    expect(state.sessions[0].id).toBe(older.id)
    expect(state.sessions[0].title).toBe(firstUserMessage.slice(0, 30))
    expect(savedSessions[0].id).toBe(older.id)
  })

  it('shows an error when the OpenAI API key is missing', async () => {
    vi.mocked(useAppStore.getState).mockReturnValueOnce({
      ...createDefaultAppState(),
      aiConfig: {
        activeProvider: 'none',
        providers: {
          openai: { apiKey: '', model: 'gpt-5.4', updatedAt: '' },
          gemini: { model: '', updatedAt: '' },
        },
      },
    } as ReturnType<typeof useAppStore.getState>)

    await useChatStore.getState().createSession()
    await useChatStore.getState().sendMessage('hello')

    expect(useChatStore.getState().error).toContain(OPENAI_KEY_LABEL)
  })
})
