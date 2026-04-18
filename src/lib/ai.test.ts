import { afterEach, describe, expect, it, vi } from 'vitest'
import { hydratePersistedState } from '@/domain/logic'
import type { ActivitySession } from '@/domain/action-log-types'
import type { Quest, QuestCompletion } from '@/domain/types'
import type { FitbitSummary, HealthDataEntry, NutritionDayResult } from '@/lib/api-client'
import {
  buildLilyChatSystemPrompt,
  generateDailyActivityLogSummary,
  generateDailyHealthSummary,
  generateDailyQuestSummary,
  generateWeeklyActivityReview,
  generateWeeklyReflection,
  generateLilyMessageWithProvider,
  generateTtsAudio,
  resolveSkillWithProvider,
  sendLilyChatMessage,
  testProviderConnection,
} from '@/lib/ai'

function createActivitySession(id: string, overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id,
    deviceId: 'device_main',
    startedAt: '2026-04-17T09:00:00+09:00',
    endedAt: '2026-04-17T09:45:00+09:00',
    dateKey: '2026-04-17',
    title: 'Chrome 拡張の調査',
    primaryCategory: '学習',
    activityKinds: ['調査'],
    appNames: ['Chrome'],
    domains: ['developer.chrome.com'],
    projectNames: [],
    summary: 'Chrome 拡張まわりの調査を進めていた。',
    searchKeywords: ['Chrome拡張', 'developer.chrome.com'],
    noteIds: [],
    hidden: false,
    ...overrides,
  }
}

function createQuest(id = 'quest_1', overrides: Partial<Quest> = {}): Quest {
  return {
    id,
    title: '朝の読書',
    description: '静かな読書時間',
    questType: 'repeatable',
    xpReward: 5,
    category: '学習',
    skillMappingMode: 'ask_each_time',
    cooldownMinutes: 0,
    dailyCompletionCap: 10,
    status: 'active',
    privacyMode: 'normal',
    pinned: false,
    createdAt: '2026-04-17T07:00:00+09:00',
    updatedAt: '2026-04-17T07:00:00+09:00',
    ...overrides,
  }
}

function createCompletion(
  id = 'completion_1',
  questId = 'quest_1',
  overrides: Partial<QuestCompletion> = {},
): QuestCompletion {
  return {
    id,
    questId,
    clientRequestId: `req_${id}`,
    completedAt: '2026-04-17T08:00:00+09:00',
    userXpAwarded: 5,
    skillResolutionStatus: 'resolved',
    createdAt: '2026-04-17T08:00:00+09:00',
    ...overrides,
  }
}

function createHealthDataEntry(overrides: Partial<HealthDataEntry> = {}): HealthDataEntry {
  return {
    date: '2026-04-17',
    time: '07:10',
    weight_kg: 61.2,
    body_fat_pct: 18.1,
    source: 'health-planet',
    ...overrides,
  }
}

function createFitbitSummary(overrides: Partial<FitbitSummary> = {}): FitbitSummary {
  return {
    date: '2026-04-17',
    heart: {
      resting_heart_rate: 58,
      intraday_points: 0,
      heart_zones: [],
    },
    active_zone_minutes: {
      intraday_points: 0,
      minutes_total_estimate: 22,
      summary_rows: 1,
    },
    sleep: {
      main_sleep: {
        date_of_sleep: '2026-04-17',
        start_time: '2026-04-16T23:45:00.000',
        end_time: '2026-04-17T06:40:00.000',
        minutes_asleep: 390,
        minutes_awake: 25,
        time_in_bed: 415,
        deep_minutes: 70,
        light_minutes: 240,
        rem_minutes: 80,
        wake_minutes: 25,
      },
      all_sleep_count: 1,
    },
    activity: {
      steps: 8123,
      distance: 5.4,
      calories: 2100,
      very_active_minutes: 12,
      fairly_active_minutes: 18,
      lightly_active_minutes: 30,
      sedentary_minutes: 500,
    },
    ...overrides,
  }
}

function createNutritionDayResult(): NutritionDayResult {
  return {
    breakfast: null,
    lunch: null,
    dinner: null,
    daily: {
      userId: 'user_1',
      date: '2026-04-17',
      mealType: 'daily',
      nutrients: {
        energy: { value: 1850, unit: 'kcal', label: '適正', threshold: null },
        protein: { value: 70, unit: 'g', label: '適正', threshold: null },
        fat: { value: 55, unit: 'g', label: '適正', threshold: null },
        carbs: { value: 230, unit: 'g', label: '適正', threshold: null },
        potassium: { value: 1800, unit: 'mg', label: '不足', threshold: null },
        calcium: { value: 700, unit: 'mg', label: '適正', threshold: null },
        iron: { value: 7, unit: 'mg', label: '適正', threshold: null },
        vitaminA: { value: 650, unit: 'µg', label: '適正', threshold: null },
        vitaminE: { value: 6, unit: 'mg', label: '適正', threshold: null },
        vitaminB1: { value: 0.8, unit: 'mg', label: '不足', threshold: null },
        vitaminB2: { value: 1.2, unit: 'mg', label: '適正', threshold: null },
        vitaminB6: { value: 1.0, unit: 'mg', label: '適正', threshold: null },
        vitaminC: { value: 90, unit: 'mg', label: '適正', threshold: null },
        fiber: { value: 14, unit: 'g', label: '不足', threshold: null },
        saturatedFat: { value: 7, unit: 'g', label: '適正', threshold: null },
        salt: { value: 9, unit: 'g', label: '過剰', threshold: null },
      },
      createdAt: '2026-04-17T20:00:00+09:00',
      updatedAt: '2026-04-17T20:00:00+09:00',
    },
  }
}

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

  it('parses OpenAI weekly reflection output and always uses gpt-5.4', async () => {
    const state = hydratePersistedState()
    state.aiConfig.activeProvider = 'gemini'
    state.aiConfig.providers.openai.apiKey = 'sk-test'
    state.aiConfig.providers.openai.model = 'gpt-4.1-mini'

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"comment":"great week","recommendations":["keep mornings light","protect one focus block"]}',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await generateWeeklyReflection({
      aiConfig: state.aiConfig,
      settings: state.settings,
      summary: {
        weekKey: '2026-W15',
        weekLabel: '2026-04-06 〜 2026-04-12',
        startDate: '2026-04-06',
        endDate: '2026-04-12',
        totalCompletionCount: 5,
        totalUserXp: 25,
        activeDayCount: 5,
        dailySummaries: [],
        dailyQuestSummaries: [],
        topQuestSummaries: [],
        topSkillSummaries: [],
        hasData: true,
      },
    })

    expect(result.provider).toBe('openai')
    expect(result.comment).toBe('great week')
    expect(result.recommendations).toEqual(['keep mornings light', 'protect one focus block'])

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.model).toBe('gpt-5.4')
  })

  it('falls back to a template weekly reflection when OpenAI is unavailable', async () => {
    const state = hydratePersistedState()
    state.settings.aiEnabled = false

    const result = await generateWeeklyReflection({
      aiConfig: state.aiConfig,
      settings: state.settings,
      summary: {
        weekKey: '2026-W15',
        weekLabel: '2026-04-06 〜 2026-04-12',
        startDate: '2026-04-06',
        endDate: '2026-04-12',
        totalCompletionCount: 5,
        totalUserXp: 25,
        activeDayCount: 5,
        dailySummaries: [],
        dailyQuestSummaries: [],
        topQuestSummaries: [],
        topSkillSummaries: [],
        hasData: true,
      },
    })

    expect(result.provider).toBe('template')
    expect(result.comment.length).toBeGreaterThan(0)
    expect(result.recommendations.length).toBeGreaterThan(0)
    expect(result.recommendations.length).toBeLessThanOrEqual(3)
  })

  it('generates DailyActivityLog summary section with gpt-5.4 and observation-diary prompt', async () => {
    const state = hydratePersistedState()
    state.aiConfig.activeProvider = 'gemini'
    state.aiConfig.providers.openai.apiKey = 'sk-test'
    state.aiConfig.providers.openai.model = 'gpt-4.1-mini'

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"summary":"リリィは、この日は拡張の調査に静かな集中が集まっていたと見ている。","mainThemes":["Chrome拡張","調査"],"reviewQuestions":["次に確認したい仕様はどこだったか。","調査のあとに着手したい一歩は何か。"]}',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await generateDailyActivityLogSummary({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-17',
      sessions: [createActivitySession('session_1')],
    })

    expect(result.summary).toContain('リリィは')
    expect(result.mainThemes).toEqual(['Chrome拡張', '調査'])

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.model).toBe('gpt-5.4')
    expect(body.max_output_tokens).toBe(1600)
    expect(body.input[0].content[0].text).toContain('観察日記風')
    expect(body.input[0].content[0].text).toContain('直接話しかける口調は禁止')
    expect(body.input[1].content[0].text).toContain('ActivitySession')
  })

  it('generates DailyActivityLog quest summary section with gpt-5.4 quest inputs', async () => {
    const state = hydratePersistedState()
    state.aiConfig.activeProvider = 'gemini'
    state.aiConfig.providers.openai.apiKey = 'sk-test'
    state.aiConfig.providers.openai.model = 'gpt-4.1-mini'

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"questSummary":"リリィは、この日のクエスト達成が小さな区切りをいくつか残していたと見ている。"}',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await generateDailyQuestSummary({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-17',
      quests: [createQuest()],
      completions: [createCompletion()],
    })

    expect(result.questSummary).toContain('リリィは')

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.model).toBe('gpt-5.4')
    expect(body.max_output_tokens).toBe(1600)
    expect(body.input[0].content[0].text).toContain('観察日記風')
    expect(body.input[1].content[0].text).toContain('QuestCompletion')
    expect(body.input[1].content[0].text).toContain('Quest')
  })

  it('generates DailyActivityLog health summary section with gpt-5.4 health inputs', async () => {
    const state = hydratePersistedState()
    state.aiConfig.activeProvider = 'gemini'
    state.aiConfig.providers.openai.apiKey = 'sk-test'
    state.aiConfig.providers.openai.model = 'gpt-4.1-mini'

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"healthSummary":"リリィは、この日の健康記録が静かに朝の輪郭を残していたと見ている。"}',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await generateDailyHealthSummary({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-17',
      healthData: [createHealthDataEntry()],
      fitbitData: [createFitbitSummary()],
      nutritionData: createNutritionDayResult(),
    })

    expect(result.healthSummary).toContain('リリィ')

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.model).toBe('gpt-5.4')
    expect(body.max_output_tokens).toBe(1600)
    expect(body.input[0].content[0].text).toContain('観察日記風')
    expect(body.input[1].content[0].text).toContain('health-data')
    expect(body.input[1].content[0].text).toContain('fitbit-data')
    expect(body.input[1].content[0].text).toContain('nutrition-data')
  })

  it('falls back to an observation-diary weekly review when OpenAI is unavailable', async () => {
    const state = hydratePersistedState()
    state.settings.aiEnabled = false

    const result = await generateWeeklyActivityReview({
      aiConfig: state.aiConfig,
      settings: state.settings,
      weekKey: '2026-W16',
      sessions: [createActivitySession('session_1')],
      categoryDurations: { 学習: 45 },
    })

    expect(result.provider).toBe('template')
    expect(result.summary).toContain('リリィ')
    expect(result.summary).not.toContain('あなた')
    expect(result.focusThemes.length).toBeGreaterThan(0)
  })
})

describe('Lily chat prompt', () => {
  it('includes desktop-aligned tone, plain-text guidance, and JST date rules', () => {
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

    expect(prompt).toContain('あなたの名前はリリィです。')
    expect(prompt).not.toContain('リリー')
    expect(prompt).toContain('「です・ます」調は使わず')
    expect(prompt).toContain('Markdown記法は使わず')
    expect(prompt).toContain('プレーンテキスト')
    expect(prompt).toContain('YYYY-MM-DD')
    expect(prompt).toContain('date 引数')
    expect(prompt).toContain('period=today/week/month')
    expect(prompt).toContain('type=chat_messages')
    expect(prompt).toContain('sessionId なしで全セッション横断検索')
    expect(prompt).toContain('漢字・ひらがな・カタカナの表記ゆれや言い換え、近いニュアンスの差を許容')
    expect(prompt).toContain('get_messages_and_logs')
    expect(prompt).toContain('Read 30 minutes')
    expect(prompt).not.toContain('葉留佳')
    expect(prompt).not.toContain('はるちん')
    expect(prompt).not.toContain('pose_category')
    expect(prompt).not.toContain('JSON形式で回答してください')
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
    expect(prompt).toContain('まだ完了記録がありません')
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
