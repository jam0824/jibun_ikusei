import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LilyChatScreen } from '@/screens/lily-chat-screen'
import { useAppStore } from '@/store/app-store'
import { useChatStore } from '@/store/chat-store'

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/chat']}>
      <Routes>
        <Route path="/chat" element={<LilyChatScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('lily chat screen', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    useChatStore.setState({
      sessions: [],
      currentSessionId: 'chat_1',
      currentMessages: [
        {
          id: 'msg_system',
          sessionId: 'chat_1',
          role: 'system',
          content: '学習クエスト達成です。+2 XP 獲得しました。',
          createdAt: '2026-04-15T10:00:00+09:00',
        },
      ],
      isLoading: false,
      isSending: false,
      error: null,
      initialize: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue('chat_1'),
      selectSession: vi.fn().mockResolvedValue(undefined),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
    })
    useAppStore.setState({
      aiConfig: {
        activeProvider: 'openai',
        providers: {
          openai: {
            apiKey: 'sk-test',
            model: 'gpt-5.4',
            updatedAt: '2026-04-15T10:00:00+09:00',
          },
          gemini: {
            model: '',
            updatedAt: '2026-04-15T10:00:00+09:00',
          },
        },
      },
    })
  })

  it('renders system messages as right-aligned bubbles with a distinct variant', () => {
    const { container } = renderScreen()

    expect(screen.getByText('学習クエスト達成です。+2 XP 獲得しました。')).toBeInTheDocument()
    const bubble = container.querySelector('[data-message-role="system"]')
    expect(bubble).toBeTruthy()
    expect(bubble?.className).toContain('bg-sky-600')
  })
})
