import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { Menu, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/date'
import { Button } from '@/components/ui'
import { BottomNav } from '@/components/layout'
import { useChatStore } from '@/store/chat-store'
import { useAppStore } from '@/store/app-store'

const SPEAKER_PREFIX_RE = /^\[(雑談|掛け合い):(リリィ|葉留佳)\]\s*/
function parseAssistantMessage(content: string) {
  const isHaruka = /^\[(雑談|掛け合い):葉留佳\]/.test(content)
  const displayContent = content.replace(SPEAKER_PREFIX_RE, '')
  return { isHaruka, displayContent }
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-sm">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  )
}

export function LilyChatScreen() {
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const {
    sessions,
    currentSessionId,
    currentMessages,
    isSending,
    error,
    initialize,
    createSession,
    selectSession,
    deleteSession,
    sendMessage,
    clearError,
  } = useChatStore(
    useShallow((state) => ({
      sessions: state.sessions,
      currentSessionId: state.currentSessionId,
      currentMessages: state.currentMessages,
      isSending: state.isSending,
      error: state.error,
      initialize: state.initialize,
      createSession: state.createSession,
      selectSession: state.selectSession,
      deleteSession: state.deleteSession,
      sendMessage: state.sendMessage,
      clearError: state.clearError,
    })),
  )

  const openaiKey = useAppStore((state) => state.aiConfig.providers.openai.apiKey)
  const hasApiKey = Boolean(openaiKey)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages, isSending])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isSending) return

    // Auto-create session if none selected
    if (!currentSessionId) {
      await createSession()
    }

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    await sendMessage(trimmed)
  }, [input, isSending, currentSessionId, createSession, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }

  const handleNewChat = async () => {
    await createSession()
    setDrawerOpen(false)
  }

  const handleSelectSession = async (sessionId: string) => {
    await selectSession(sessionId)
    setDrawerOpen(false)
  }

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    await deleteSession(sessionId)
  }

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(167,139,250,0.15),_transparent_35%),linear-gradient(to_bottom,_#f5f3ff,_#f8fafc_38%,_#f1f5f9)]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Button
            size="icon"
            variant="ghost"
            className="rounded-2xl"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="text-sm font-semibold text-slate-900">リリィ</div>
          <Button
            size="icon"
            variant="ghost"
            className="rounded-2xl"
            onClick={() => void handleNewChat()}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4">
        {currentMessages.length === 0 && !isSending ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-100">
                <Sparkles className="h-8 w-8 text-violet-600" />
              </div>
              <div className="text-lg font-semibold text-slate-900">リリィと話そう</div>
              <div className="mt-2 text-sm text-slate-500">
                あなたの成長について、何でも聞いてみてください。
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-4">
            {currentMessages.map((msg) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-violet-600 px-4 py-3 text-sm leading-6 text-white shadow-sm">
                    {msg.content}
                  </div>
                </div>
              ) : (
                (() => {
                  const { isHaruka, displayContent } = parseAssistantMessage(msg.content)
                  return (
                    <div key={msg.id} className="flex items-start gap-3">
                      <img
                        src={`${import.meta.env.BASE_URL}${isHaruka ? 'aikata/haruka_face.png' : 'lily/face.png'}`}
                        alt={isHaruka ? '葉留佳' : 'リリィ'}
                        className="h-13 w-13 shrink-0 rounded-full object-cover"
                      />
                      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm leading-6 text-slate-700 shadow-sm">
                        {displayContent}
                      </div>
                    </div>
                  )
                })()
              ),
            )}
            {isSending ? <TypingIndicator /> : null}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Error */}
      {error ? (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
          <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={clearError} className="shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Input Area */}
      <div className="border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          {hasApiKey ? (
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力..."
                rows={1}
                className="flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
                style={{ maxHeight: '96px' }}
              />
              <Button
                size="icon"
                className="shrink-0 rounded-2xl"
                disabled={!input.trim() || isSending}
                onClick={() => void handleSend()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-center">
              <div className="text-sm text-slate-700">
                リリィとチャットするにはOpenAI APIキーの設定が必要です。
              </div>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => navigate('/settings')}
              >
                設定画面を開く
              </Button>
            </div>
          )}
        </div>
      </div>

      <BottomNav />

      {/* Drawer Overlay */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/30"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      {/* Side Drawer */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-72 transform bg-white shadow-xl transition-transform duration-200',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">会話履歴</div>
            <Button
              size="icon"
              variant="ghost"
              className="rounded-2xl"
              onClick={() => setDrawerOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-3">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-violet-300 px-4 py-3 text-sm font-medium text-violet-700 transition hover:bg-violet-50"
              onClick={() => void handleNewChat()}
            >
              <Plus className="h-4 w-4" />
              新規チャット
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {sessions.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">
                会話履歴がありません
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left transition',
                      session.id === currentSessionId
                        ? 'bg-violet-50 text-violet-700'
                        : 'text-slate-700 hover:bg-slate-50',
                    )}
                    onClick={() => void handleSelectSession(session.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{session.title}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {formatDate(session.updatedAt, 'yyyy/M/d')}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg p-1 text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                      onClick={(e) => void handleDeleteSession(e, session.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
