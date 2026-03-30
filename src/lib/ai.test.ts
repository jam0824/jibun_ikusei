import { afterEach, describe, expect, it, vi } from 'vitest'
import { hydratePersistedState } from '@/domain/logic'
import {
  buildLilyChatSystemPrompt,
  generateLilyMessageWithProvider,
  generateTtsAudio,
  resolveSkillWithProvider,
  sendLilyChatMessage,
  testProviderConnection,
} from '@/lib/ai'

describe('ai adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tests OpenAI connection with mocked fetch', async () => {
    const state = hydratePersistedState()
    state.aiConfig.providers.openai.apiKey = 'sk-test'

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ output_text: '{"ok": true}' }), { status: 200 }),
    )

    await expect(testProviderConnection(state.aiConfig, state.settings, 'openai')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('throws when provider checks run offline', async () => {
    const state = hydratePersistedState()
    state.aiConfig.providers.openai.apiKey = 'sk-test'

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    })

    await expect(testProviderConnection(state.aiConfig, state.settings, 'openai')).rejects.toThrow()
  })

  it('falls back to local skill resolution when AI is disabled', async () => {
    const state = hydratePersistedState()
    state.settings.aiEnabled = false
    const skill = state.skills[0]
    const quest = {
      id: 'quest_test',
      title: skill.name,
      description: '',
      questType: 'repeatable' as const,
      xpReward: 5,
      category: skill.category,
      skillMappingMode: 'ai_auto' as const,
      status: 'active' as const,
      privacyMode: 'normal' as const,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const result = await resolveSkillWithProvider({
      aiConfig: state.aiConfig,
      settings: state.settings,
      quest,
      note: 'test note',
      skills: state.skills,
      dictionary: [],
    })

    expect(result.skillName).toBe(skill.name)
  })

  it('parses OpenAI output_text fragments for Lily messages', async () => {
    const state = hydratePersistedState()
    state.aiConfig.providers.openai.apiKey = 'sk-test'

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"intent":"quest_completed","mood":"playful","text":"nice job","shouldSpeak":true}',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await generateLilyMessageWithProvider({
      aiConfig: state.aiConfig,
      settings: state.settings,
      payload: { intent: 'quest_completed' },
    })

    expect(result.text).toBe('nice job')
    expect(result.shouldSpeak).toBe(true)
  })

  it('wraps Gemini PCM audio in a wav blob', async () => {
    const state = hydratePersistedState()
    state.aiConfig.activeProvider = 'gemini'
    state.aiConfig.providers.gemini.apiKey = 'gm-test'
    state.settings.aiEnabled = true
    state.settings.lilyVoiceEnabled = true

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tts')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: btoa(String.fromCharCode(1, 0, 255, 127)),
                      mimeType: 'audio/L16;rate=24000',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await generateTtsAudio({
      aiConfig: state.aiConfig,
      settings: state.settings,
      text: 'hello audio',
    })

    expect(result).toBe('blob:tts')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
  })

  it('throws for TTS when offline', async () => {
    const state = hydratePersistedState()
    state.aiConfig.activeProvider = 'gemini'
    state.aiConfig.providers.gemini.apiKey = 'gm-test'
    state.settings.aiEnabled = true
    state.settings.lilyVoiceEnabled = true

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    })

    await expect(
      generateTtsAudio({
        aiConfig: state.aiConfig,
        settings: state.settings,
        text: 'hello audio',
      }),
    ).rejects.toThrow()
  })
})

describe('Lily chat prompt', () => {
  it('includes user context and JST explicit date guidance', () => {
    const state = hydratePersistedState()
    state.user.level = 5
    state.user.totalXp = 120

    const prompt = buildLilyChatSystemPrompt({
      user: state.user,
      skills: state.skills,
      quests: [
        {
          id: 'q1',
          title: 'Read 30 minutes',
          questType: 'repeatable',
          xpReward: 5,
          category: 'Study',
          skillMappingMode: 'ai_auto',
          status: 'active',
          privacyMode: 'normal',
          pinned: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
      recentCompletions: [{ questTitle: 'Read 30 minutes', completedAt: '2026-03-22T10:00:00Z' }],
      activityLogs: [
        { timestamp: '2026-03-22T10:00:00Z', source: 'web', action: 'quest_completed', category: 'quest', details: {} },
        { timestamp: '2026-03-22T11:00:00Z', source: 'web', action: 'quest_completed', category: 'quest', details: {} },
      ],
    })

    expect(prompt).toContain('YYYY-MM-DD')
    expect(prompt).toContain('date 引数')
    expect(prompt).toContain('period=today/week/month')
    expect(prompt).toContain('type=chat_messages')
    expect(prompt).toContain('sessionId なしで全セッション横断検索')
    expect(prompt).toContain('get_messages_and_logs')
    expect(prompt).toContain('Read 30 minutes')
  })

  it('handles empty context', () => {
    const state = hydratePersistedState()

    const prompt = buildLilyChatSystemPrompt({
      user: state.user,
      skills: [],
      quests: [],
      recentCompletions: [],
      activityLogs: [],
    })

    expect(prompt).toContain('まだスキルがありません')
    expect(prompt).toContain('まだクエストがありません')
    expect(prompt).toContain('まだ完了履歴がありません')
  })
})

describe('Lily chat completions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns normal text responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'plain response' } }] }),
        { status: 200 },
      ),
    )

    const result = await sendLilyChatMessage({
      apiKey: 'sk-test',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'hello' },
      ],
    })

    expect(result).toEqual({ type: 'text', content: 'plain response' })
  })

  it('normalizes array-based text content responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: 'first line' },
                  { type: 'text', text: 'second line' },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await sendLilyChatMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(result).toEqual({ type: 'text', content: 'first line\nsecond line' })
  })

  it('passes tools through to the API request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200 },
      ),
    )

    await sendLilyChatMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].function.name).toBe('test_tool')
  })

  it('returns tool calls when the model requests them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: { name: 'get_browsing_times', arguments: '{"date":"2026-03-29"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await sendLilyChatMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'show me 2026-03-29' }],
    })

    expect(result.type).toBe('tool_calls')
    if (result.type === 'tool_calls') {
      expect(result.toolCalls[0].function.name).toBe('get_browsing_times')
    }
  })

  it('returns tool calls even when finish_reason is not tool_calls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_456',
                    type: 'function',
                    function: { name: 'get_messages_and_logs', arguments: '{"type":"chat_messages","date":"2026-03-29"}' },
                  },
                ],
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await sendLilyChatMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'show me 2026-03-29 chat details' }],
    })

    expect(result.type).toBe('tool_calls')
    if (result.type === 'tool_calls') {
      expect(result.toolCalls[0].function.name).toBe('get_messages_and_logs')
    }
  })

  it('retries with a larger completion budget when the first response is truncated', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: null },
                finish_reason: 'length',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: 'summary after retry' },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200 },
        ),
      )

    const result = await sendLilyChatMessage({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'summarize 2026-03-29 chat' }],
    })

    expect(result).toEqual({ type: 'text', content: 'summary after retry' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstBody = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))
    expect(firstBody.max_completion_tokens).toBe(900)
    expect(secondBody.max_completion_tokens).toBe(1600)
  })
})
