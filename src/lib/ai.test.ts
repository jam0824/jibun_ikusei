import { afterEach, describe, expect, it, vi } from 'vitest'
import { hydratePersistedState } from '@/domain/logic'
import { generateLilyMessageWithProvider, resolveSkillWithProvider, testProviderConnection } from '@/lib/ai'

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
})
