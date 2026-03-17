import { afterEach, describe, expect, it, vi } from 'vitest'
import { hydratePersistedState } from '@/domain/logic'
import {
  generateLilyMessageWithProvider,
  generateTtsAudio,
  resolveSkillWithProvider,
  testProviderConnection,
} from '@/lib/ai'

describe('ai adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tests OpenAI connection via mocked fetch', async () => {
    const state = hydratePersistedState()
    state.aiConfig.providers.openai.apiKey = 'sk-test'

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output_text: '{"ok": true}',
        }),
        { status: 200 },
      ),
    )

    await expect(testProviderConnection(state.aiConfig, state.settings, 'openai')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it('returns a clear offline error for provider checks', async () => {
    const state = hydratePersistedState()
    state.aiConfig.providers.openai.apiKey = 'sk-test'

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    })

    await expect(testProviderConnection(state.aiConfig, state.settings, 'openai')).rejects.toThrow(
      'AI接続テストはオフラインでは利用できません。ネットワーク接続を確認してください。',
    )
  })

  it('falls back to local resolution when AI is unavailable', async () => {
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

  it('falls back to local resolution when OpenAI returns no output_text', async () => {
    const state = hydratePersistedState()
    state.aiConfig.providers.openai.apiKey = 'sk-test'
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

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'refusal',
                  refusal: 'Cannot comply.',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )

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

  it('parses OpenAI message content from response.output', async () => {
    const state = hydratePersistedState()
    state.aiConfig.providers.openai.apiKey = 'sk-test'

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'reasoning',
              summary: [],
            },
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
      payload: {
        intent: 'quest_completed',
      },
    })

    expect(result.text).toBe('nice job')
    expect(result.shouldSpeak).toBe(true)
  })

  it('retries OpenAI responses on 500 and then succeeds', async () => {
    const state = hydratePersistedState()
    state.aiConfig.providers.openai.apiKey = 'sk-test'

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'temporary server issue',
              type: 'server_error',
            },
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: '{"intent":"quest_completed","mood":"bright","text":"retry ok","shouldSpeak":false}',
          }),
          { status: 200 },
        ),
      )

    const result = await generateLilyMessageWithProvider({
      aiConfig: state.aiConfig,
      settings: state.settings,
      payload: {
        intent: 'quest_completed',
      },
    })

    expect(result.text).toBe('retry ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the Gemini API TTS runtime model and wraps PCM audio as wav', async () => {
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
      text: '今日もよく頑張ったね',
    })

    expect(result).toBe('blob:tts')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toContain('/models/gemini-2.5-flash-lite-preview-tts:generateContent')

    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'gm-test',
    })

    const body = JSON.parse(String(request.body))
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Zephyr')
    expect(body.speechConfig).toBeUndefined()

    const createdBlob = createObjectUrl.mock.calls[0]?.[0]
    expect(createdBlob).toBeInstanceOf(Blob)
    const audioBlob = createdBlob as Blob
    expect(audioBlob.type).toBe('audio/wav')

    const wavHeader = new Uint8Array(await audioBlob.arrayBuffer()).slice(0, 4)
    expect(Array.from(wavHeader)).toEqual([82, 73, 70, 70])
  })

  it('includes Gemini TTS error details when the API returns 400', async () => {
    const state = hydratePersistedState()
    state.aiConfig.activeProvider = 'gemini'
    state.aiConfig.providers.gemini.apiKey = 'gm-test'
    state.settings.aiEnabled = true
    state.settings.lilyVoiceEnabled = true

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: 'Invalid JSON payload.',
            status: 'INVALID_ARGUMENT',
          },
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    await expect(
      generateTtsAudio({
        aiConfig: state.aiConfig,
        settings: state.settings,
        text: '音声チェック',
      }),
    ).rejects.toThrow('Gemini TTS failed: 400 - Invalid JSON payload.')
  })

  it('returns a clear offline error for TTS generation', async () => {
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
        text: '音声チェック',
      }),
    ).rejects.toThrow('音声再生はオフラインでは利用できません。ネットワーク接続を確認してください。')
  })
})
