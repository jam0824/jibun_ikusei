import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  getChatSessions: vi.fn().mockResolvedValue([]),
  postChatSession: vi.fn().mockResolvedValue({}),
  putChatSession: vi.fn().mockResolvedValue({}),
  deleteChatSession: vi.fn().mockResolvedValue({}),
  getChatMessages: vi.fn().mockResolvedValue([]),
  postChatMessage: vi.fn().mockResolvedValue({}),
  getActivityLogs: vi.fn().mockResolvedValue([]),
}))

// Mock ai
vi.mock('@/lib/ai', () => ({
  buildLilyChatSystemPrompt: vi.fn().mockReturnValue('system prompt'),
  sendLilyChatMessage: vi.fn().mockResolvedValue('リリィの応答です'),
}))

// Mock app-store
vi.mock('@/store/app-store', () => ({
  useAppStore: {
    getState: vi.fn().mockReturnValue({
      user: { id: 'local_user', level: 3, totalXp: 50, createdAt: '', updatedAt: '' },
      skills: [],
      completions: [],
      quests: [],
      aiConfig: {
        activeProvider: 'openai',
        providers: {
          openai: { apiKey: 'sk-test', model: 'gpt-5.4', updatedAt: '' },
          gemini: { model: '', updatedAt: '' },
        },
      },
    }),
  },
}))

describe('チャットストア', () => {
  beforeEach(() => {
    localStorage.clear()
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      currentMessages: [],
      isLoading: false,
      isSending: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('新規セッションを作成できる', async () => {
    const sessionId = await useChatStore.getState().createSession()

    expect(sessionId).toMatch(/^chat_/)
    expect(useChatStore.getState().sessions).toHaveLength(1)
    expect(useChatStore.getState().currentSessionId).toBe(sessionId)
    expect(useChatStore.getState().sessions[0].title).toBe('新しい会話')
  })

  it('セッション選択時にメッセージを読み込む', async () => {
    const apiClient = await import('@/lib/api-client')
    const cloudMessages = [
      { id: 'cmsg_1', sessionId: 'chat_test', role: 'user' as const, content: 'テスト', createdAt: '' },
    ]
    vi.mocked(apiClient.getChatMessages).mockResolvedValueOnce(cloudMessages)

    const sessionId = await useChatStore.getState().createSession()
    await useChatStore.getState().selectSession(sessionId)

    expect(useChatStore.getState().currentSessionId).toBe(sessionId)
    expect(useChatStore.getState().currentMessages).toHaveLength(1)
    expect(useChatStore.getState().currentMessages[0].content).toBe('テスト')
  })

  it('セッション削除でリストから除外される', async () => {
    const sessionId = await useChatStore.getState().createSession()
    expect(useChatStore.getState().sessions).toHaveLength(1)

    await useChatStore.getState().deleteSession(sessionId)

    expect(useChatStore.getState().sessions).toHaveLength(0)
    expect(useChatStore.getState().currentSessionId).toBeNull()
  })

  it('メッセージ送信でユーザーとアシスタントのメッセージが追加される', async () => {
    await useChatStore.getState().createSession()

    await useChatStore.getState().sendMessage('こんにちは')

    const messages = useChatStore.getState().currentMessages
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('こんにちは')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('リリィの応答です')
  })

  it('初回メッセージでセッションタイトルが更新される', async () => {
    await useChatStore.getState().createSession()

    await useChatStore.getState().sendMessage('今日の運動について相談')

    const session = useChatStore.getState().sessions[0]
    expect(session.title).toBe('今日の運動について相談')
  })

  it('APIキー未設定時にエラーを表示する', async () => {
    const { useAppStore } = await import('@/store/app-store')
    vi.mocked(useAppStore.getState).mockReturnValueOnce({
      user: { id: 'local_user', level: 1, totalXp: 0, createdAt: '', updatedAt: '' },
      skills: [],
      completions: [],
      quests: [],
      aiConfig: {
        activeProvider: 'none',
        providers: {
          openai: { apiKey: '', model: 'gpt-5.4', updatedAt: '' },
          gemini: { model: '', updatedAt: '' },
        },
      },
    } as ReturnType<typeof useAppStore.getState>)

    await useChatStore.getState().createSession()
    await useChatStore.getState().sendMessage('テスト')

    expect(useChatStore.getState().error).toContain('OpenAI APIキーが設定されていません')
  })
})
