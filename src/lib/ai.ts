import { z } from 'zod'
import { buildTemplateSkillResolution, getProviderConfig, hasUsableAi } from '@/domain/logic'
import type {
  AiConfig,
  LilyMessageResult,
  PersonalSkillDictionary,
  Quest,
  Skill,
  SkillResolutionResult,
  UserSettings,
} from '@/domain/types'
import { createOfflineError, isOffline } from '@/lib/network'

const skillResolutionSchema = z.object({
  action: z.enum(['assign_existing', 'assign_seed', 'propose_new', 'unclassified']),
  skillName: z.string().min(1),
  category: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  candidateSkills: z.array(z.string()).min(1).max(3),
})

const lilyMessageSchema = z.object({
  intent: z.enum(['quest_completed', 'user_level_up', 'skill_level_up', 'daily_summary', 'weekly_reflection', 'nudge']),
  mood: z.enum(['bright', 'calm', 'playful', 'epic']),
  text: z.string().min(1),
  shouldSpeak: z.boolean(),
})

const skillResolutionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['assign_existing', 'assign_seed', 'propose_new', 'unclassified'],
    },
    skillName: { type: 'string' },
    category: { type: 'string' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    candidateSkills: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    },
  },
  required: ['action', 'skillName', 'category', 'confidence', 'reason', 'candidateSkills'],
}

const lilyMessageJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['quest_completed', 'user_level_up', 'skill_level_up', 'daily_summary', 'weekly_reflection', 'nudge'],
    },
    mood: {
      type: 'string',
      enum: ['bright', 'calm', 'playful', 'epic'],
    },
    text: { type: 'string' },
    shouldSpeak: { type: 'boolean' },
  },
  required: ['intent', 'mood', 'text', 'shouldSpeak'],
}

const DEFAULT_JSON_SYSTEM_PROMPT =
  'You are the structured-output engine for a self-growth app. Return only valid JSON that strictly matches the provided schema. Do not include markdown or extra commentary.'

const CONNECTION_TEST_SYSTEM_PROMPT =
  'Return only valid JSON that strictly matches the provided schema. Reply with {"ok": true}.'

const LILY_MESSAGE_SYSTEM_PROMPT =
  'You are Lily, a warm and encouraging companion in a self-growth app. Return only valid JSON that strictly matches the provided schema.'

const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504])

function buildSkillResolutionSystemPrompt(skills: Skill[]) {
  const categories = Array.from(new Set(skills.map((skill) => skill.category).filter(Boolean)))

  return [
    'You classify completed quests into the most relevant life skill for a self-growth app.',
    'Return only valid JSON that strictly matches the provided schema.',
    'Use the literal meaning of the activity, not a metaphor.',
    'Physical activities such as cycling, aerobike, running, walking, stretching, workouts, and training belong to exercise or fitness related skills, not study or learning.',
    'Reuse an existing skill or seed skill when it is semantically close.',
    categories.length > 0 ? `Prefer these known categories when appropriate: ${categories.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function toDictionaryRecords(
  skills: Skill[],
  dictionary: Array<{ phrase: string; mappedSkillName: string }>,
): PersonalSkillDictionary[] {
  return dictionary.map((entry) => ({
    id: entry.phrase,
    phrase: entry.phrase,
    mappedSkillId: skills.find((skill) => skill.name === entry.mappedSkillName)?.id ?? '',
    createdAt: '',
    createdBy: 'system',
  }))
}

function buildFallbackSkillResolution(params: {
  quest: Quest
  note?: string
  skills: Skill[]
  dictionary: Array<{ phrase: string; mappedSkillName: string }>
}) {
  return buildTemplateSkillResolution(
    params.quest,
    params.note,
    params.skills,
    toDictionaryRecords(params.skills, params.dictionary),
  )
}

function extractOpenAiText(payload: Record<string, unknown>) {
  const outputText = payload.output_text
  if (typeof outputText === 'string' && outputText.trim()) {
    return outputText
  }

  const output = Array.isArray(payload.output) ? payload.output : []
  let refusalText: string | undefined

  for (const item of output) {
    if (typeof item !== 'object' || !item) {
      continue
    }

    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? ((item as { content?: unknown[] }).content ?? [])
      : []

    for (const fragment of content) {
      if (typeof fragment !== 'object' || !fragment) {
        continue
      }

      const fragmentRecord = fragment as { text?: string; refusal?: string }
      if (typeof fragmentRecord.text === 'string' && fragmentRecord.text.trim()) {
        return fragmentRecord.text
      }

      if (typeof fragmentRecord.refusal === 'string' && fragmentRecord.refusal.trim()) {
        refusalText = fragmentRecord.refusal
      }
    }
  }

  if (refusalText) {
    throw new Error(`OpenAI refused the request: ${refusalText}`)
  }

  const status = payload.status
  if (typeof status === 'string' && status !== 'completed') {
    throw new Error(`OpenAI response did not complete successfully: ${status}`)
  }

  throw new Error('OpenAI response text was empty.')
}

function isRetryableStatus(status: number) {
  return RETRYABLE_STATUS_CODES.has(status)
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function readErrorResponse(response: Response) {
  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as {
        error?: {
          message?: string
          type?: string
          code?: string
        }
      }

      if (payload.error?.message) {
        const details = [payload.error.type, payload.error.code].filter(Boolean).join('/')
        return details ? `${payload.error.message} (${details})` : payload.error.message
      }
    }

    const text = await response.text()
    return text.trim() || undefined
  } catch {
    return undefined
  }
}

async function requestOpenAiJson<T>({
  apiKey,
  model,
  schemaName,
  schema,
  input,
  systemPrompt = DEFAULT_JSON_SYSTEM_PROMPT,
}: {
  apiKey: string
  model: string
  schemaName: string
  schema: Record<string, unknown>
  input: Record<string, unknown>
  systemPrompt?: string
}) {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: systemPrompt,
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify(input),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            schema,
            strict: true,
          },
        },
        max_output_tokens: 300,
      }),
    })

    if (!response.ok) {
      const details = await readErrorResponse(response)
      lastError = new Error(
        `OpenAI request failed: ${response.status}${details ? ` - ${details}` : ''}`,
      )

      if (attempt < 3 && isRetryableStatus(response.status)) {
        await wait(300 * attempt)
        continue
      }

      throw lastError
    }

    const payload = (await response.json()) as Record<string, unknown>
    const rawText = extractOpenAiText(payload)
    return JSON.parse(rawText) as T
  }

  throw lastError ?? new Error('OpenAI request failed.')
}

async function requestGeminiJson<T>({
  apiKey,
  model,
  schema,
  input,
  systemPrompt = DEFAULT_JSON_SYSTEM_PROMPT,
}: {
  apiKey: string
  model: string
  schema: Record<string, unknown>
  input: Record<string, unknown>
  systemPrompt?: string
}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: systemPrompt,
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: JSON.stringify(input) }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    },
  )

  if (!response.ok) {
    const details = await readErrorResponse(response)
    throw new Error(`Gemini request failed: ${response.status}${details ? ` - ${details}` : ''}`)
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('Gemini response text was empty.')
  }

  return JSON.parse(text) as T
}

function getGeminiTtsRuntimeModel(ttsModel: string) {
  if (ttsModel === 'gemini-2.5-flash-tts') {
    return 'gemini-2.5-flash-preview-tts'
  }

  if (ttsModel === 'gemini-2.5-pro-tts') {
    return 'gemini-2.5-pro-preview-tts'
  }

  return ttsModel
}

function decodeBase64(data: string) {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
}

function getSampleRateFromMimeType(mimeType?: string) {
  const match = mimeType?.match(/rate=(\d+)/i)
  return match ? Number(match[1]) : 24000
}

function pcm16ToWav(bytes: Uint8Array, sampleRate: number, channelCount = 1) {
  const headerSize = 44
  const wavBuffer = new ArrayBuffer(headerSize + bytes.byteLength)
  const view = new DataView(wavBuffer)
  const blockAlign = channelCount * 2
  const byteRate = sampleRate * blockAlign

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + bytes.byteLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, bytes.byteLength, true)
  new Uint8Array(wavBuffer, headerSize).set(bytes)

  return new Blob([wavBuffer], { type: 'audio/wav' })
}

function buildGeminiAudioBlob(inlineData: { data?: string; mimeType?: string }) {
  if (!inlineData.data) {
    throw new Error('Gemini TTS payload was empty.')
  }

  const bytes = decodeBase64(inlineData.data)
  const mimeType = inlineData.mimeType?.toLowerCase()

  if (!mimeType || mimeType.startsWith('audio/l16') || mimeType.startsWith('audio/pcm')) {
    return pcm16ToWav(bytes, getSampleRateFromMimeType(mimeType))
  }

  return new Blob([bytes], { type: inlineData.mimeType })
}

export async function testProviderConnection(
  aiConfig: AiConfig,
  settings: UserSettings,
  provider: 'openai' | 'gemini',
) {
  if (!settings.aiEnabled) {
    throw new Error('AI is disabled.')
  }

  if (isOffline()) {
    throw createOfflineError('AI接続テスト')
  }

  const config = getProviderConfig(aiConfig, provider)
  if (!config?.apiKey) {
    throw new Error('API key is not configured.')
  }

  if (provider === 'openai') {
    await requestOpenAiJson({
      apiKey: config.apiKey,
      model: config.model,
      schemaName: 'connection_check',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
        },
        required: ['ok'],
      },
      input: {
        instruction: 'Return {"ok": true}.',
      },
      systemPrompt: CONNECTION_TEST_SYSTEM_PROMPT,
    })
    return true
  }

  await requestGeminiJson({
    apiKey: config.apiKey,
    model: config.model,
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
      required: ['ok'],
    },
    input: {
      instruction: 'Return {"ok": true}.',
    },
    systemPrompt: CONNECTION_TEST_SYSTEM_PROMPT,
  })
  return true
}

export async function resolveSkillWithProvider(params: {
  aiConfig: AiConfig
  settings: UserSettings
  quest: Quest
  note?: string
  skills: Skill[]
  dictionary: Array<{ phrase: string; mappedSkillName: string }>
}) {
  const { aiConfig, settings, quest, note, skills, dictionary } = params
  if (!hasUsableAi(aiConfig, settings) || quest.privacyMode === 'no_ai') {
    return buildFallbackSkillResolution({ quest, note, skills, dictionary })
  }

  if (isOffline()) {
    return buildFallbackSkillResolution({ quest, note, skills, dictionary })
  }

  const provider = aiConfig.activeProvider
  const providerConfig = getProviderConfig(aiConfig)
  if (!providerConfig?.apiKey || provider === 'none') {
    return buildFallbackSkillResolution({ quest, note, skills, dictionary })
  }

  const payload = {
    task: 'quest_skill_resolution',
    quest: {
      title: quest.title,
      description: quest.description,
      category: quest.category,
      note,
    },
    existingSkills: skills.map((skill) => ({ name: skill.name, category: skill.category })),
    seedSkills: skills
      .filter((skill) => skill.source === 'seed')
      .map((skill) => ({ name: skill.name, category: skill.category })),
    userDictionary: dictionary,
  }

  try {
    const result =
      provider === 'openai'
        ? await requestOpenAiJson<SkillResolutionResult>({
            apiKey: providerConfig.apiKey,
            model: providerConfig.model,
            schemaName: 'skill_resolution',
            schema: skillResolutionJsonSchema,
            input: payload,
            systemPrompt: buildSkillResolutionSystemPrompt(skills),
          })
        : await requestGeminiJson<SkillResolutionResult>({
            apiKey: providerConfig.apiKey,
            model: providerConfig.model,
            schema: skillResolutionJsonSchema,
            input: payload,
            systemPrompt: buildSkillResolutionSystemPrompt(skills),
          })

    return skillResolutionSchema.parse(result)
  } catch {
    return buildFallbackSkillResolution({ quest, note, skills, dictionary })
  }
}

export async function generateLilyMessageWithProvider(params: {
  aiConfig: AiConfig
  settings: UserSettings
  payload: Record<string, unknown>
}) {
  const { aiConfig, settings, payload } = params
  if (!hasUsableAi(aiConfig, settings)) {
    throw new Error('AI is unavailable.')
  }

  if (isOffline()) {
    throw createOfflineError('Lilyメッセージ生成')
  }

  const provider = aiConfig.activeProvider
  const providerConfig = getProviderConfig(aiConfig)
  if (!providerConfig?.apiKey || provider === 'none') {
    throw new Error('Provider key is unavailable.')
  }

  const result =
    provider === 'openai'
      ? await requestOpenAiJson<LilyMessageResult>({
          apiKey: providerConfig.apiKey,
          model: providerConfig.model,
          schemaName: 'lily_message',
          schema: lilyMessageJsonSchema,
          input: payload,
          systemPrompt: LILY_MESSAGE_SYSTEM_PROMPT,
        })
      : await requestGeminiJson<LilyMessageResult>({
          apiKey: providerConfig.apiKey,
          model: providerConfig.model,
          schema: lilyMessageJsonSchema,
          input: payload,
          systemPrompt: LILY_MESSAGE_SYSTEM_PROMPT,
        })

  return lilyMessageSchema.parse(result)
}

export async function generateTtsAudio(params: {
  aiConfig: AiConfig
  settings: UserSettings
  text: string
}) {
  const { aiConfig, settings, text } = params
  if (!settings.lilyVoiceEnabled || !hasUsableAi(aiConfig, settings)) {
    throw new Error('Audio generation is unavailable.')
  }

  if (isOffline()) {
    throw createOfflineError('音声再生')
  }

  const providerConfig = aiConfig.providers.gemini
  if (!providerConfig?.apiKey || !providerConfig.ttsModel || !providerConfig.voice) {
    throw new Error('Gemini TTS key is unavailable.')
  }

  const runtimeModel = getGeminiTtsRuntimeModel(providerConfig.ttsModel)
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${runtimeModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': providerConfig.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: providerConfig.voice,
              },
            },
          },
        },
      }),
    },
  )

  if (!response.ok) {
    const details = await readErrorResponse(response)
    throw new Error(`Gemini TTS failed: ${response.status}${details ? ` - ${details}` : ''}`)
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string
            mimeType?: string
          }
        }>
      }
    }>
  }

  const inlineData = payload.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData
  const blob = buildGeminiAudioBlob(inlineData ?? {})
  return URL.createObjectURL(blob)
}
