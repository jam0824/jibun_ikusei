import { z } from 'zod'
import type {
  ActivitySession,
  OpenLoop,
} from '@/domain/action-log-types'
import {
  buildTemplateSkillResolution,
  getActiveCompletions,
  getProviderConfig,
  getQuestTypeLabel,
  hasUsableAi,
  type WeeklyReflectionSummary,
} from '@/domain/logic'
import { OPENAI_MODELS } from '@/domain/constants'
import type {
  AiConfig,
  LilyMessageResult,
  LocalUser,
  PersonalSkillDictionary,
  Quest,
  QuestCompletion,
  Skill,
  SkillResolutionResult,
  UserSettings,
} from '@/domain/types'
import type { ActivityLogEntry, HealthDataEntry } from '@/lib/api-client'
import { getDayKey } from '@/lib/date'
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

const weeklyReflectionSchema = z.object({
  comment: z.string().min(1),
  recommendations: z.array(z.string().min(1)).min(1).max(3),
})

const dailyActivityLogSchema = z.object({
  summary: z.string().min(1),
  questSummary: z.string().min(1),
  healthSummary: z.string().min(1),
  mainThemes: z.array(z.string().min(1)).min(1).max(5),
  reviewQuestions: z.array(z.string().min(1)).min(1).max(3),
})

const weeklyActivityReviewSchema = z.object({
  summary: z.string().min(1),
  focusThemes: z.array(z.string().min(1)).min(1).max(5),
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

const weeklyReflectionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    comment: { type: 'string' },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    },
  },
  required: ['comment', 'recommendations'],
}

const dailyActivityLogJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    questSummary: { type: 'string' },
    healthSummary: { type: 'string' },
    mainThemes: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 5,
    },
    reviewQuestions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    },
  },
  required: ['summary', 'questSummary', 'healthSummary', 'mainThemes', 'reviewQuestions'],
}

const weeklyActivityReviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    focusThemes: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 5,
    },
  },
  required: ['summary', 'focusThemes'],
}

const DEFAULT_JSON_SYSTEM_PROMPT =
  'You are the structured-output engine for a self-growth app. Return only valid JSON that strictly matches the provided schema. Do not include markdown or extra commentary.'

const CONNECTION_TEST_SYSTEM_PROMPT =
  'Return only valid JSON that strictly matches the provided schema. Reply with {"ok": true}.'

const LILY_MESSAGE_SYSTEM_PROMPT =
  'You are Lily, a warm and encouraging companion in a self-growth app. Return only valid JSON that strictly matches the provided schema.'

const WEEKLY_REFLECTION_SYSTEM_PROMPT = [
  'You write a weekly reflection for a Japanese self-growth app called Lily.',
  'Return only valid JSON that strictly matches the provided schema.',
  'Write the comment in gentle Japanese.',
  'Structure it as: celebrate what went well, mention only one improvement point, then encourage next week.',
  'Keep the tone warm and non-judgmental.',
  'Recommendations must be 1 to 3 short Japanese suggestions.',
].join(' ')

const DAILY_ACTIVITY_LOG_SYSTEM_PROMPT = [
  'You write a DailyActivityLog for a Japanese self-growth app called Lily.',
  'Return only valid JSON that strictly matches the provided schema.',
  'Write in Japanese.',
  'The prose must read like リリィがユーザーをそっと見守って書いた観察日記風の地の文.',
  '直接話しかける口調は禁止.',
  'Do not use second-person coaching language.',
  'Generate summary, questSummary, healthSummary, mainThemes, and reviewQuestions.',
  'Use the provided ActivitySession, OpenLoop, QuestCompletion, Quest, and health-data records only.',
].join(' ')

const WEEKLY_ACTIVITY_REVIEW_SYSTEM_PROMPT = [
  'You write a WeeklyActivityReview for a Japanese self-growth app called Lily.',
  'Return only valid JSON that strictly matches the provided schema.',
  'Write in Japanese.',
  'The prose must read like リリィがユーザーをそっと見守って書いた観察日記風の地の文.',
  '直接話しかける口調は禁止.',
  'Do not use second-person coaching language.',
  'Generate only summary and focusThemes.',
  'Use only the provided ActivitySession and OpenLoop summaries plus category durations.',
].join(' ')

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
    const text = await response.text()
    if (!text.trim()) {
      return undefined
    }

    try {
      const payload = JSON.parse(text) as {
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
    } catch {
      // Not valid JSON — fall through to return raw text.
    }

    return text.trim()
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

function buildWeeklyReflectionFallback(summary: WeeklyReflectionSummary) {
  const recommendations = [
    summary.topQuestSummaries[0]
      ? `「${summary.topQuestSummaries[0].title}」を来週も続けよう`
      : undefined,
    summary.dailyQuestSummaries[0]
      ? `「${summary.dailyQuestSummaries[0].title}」は続けやすい時間を先に決めよう`
      : undefined,
    summary.activeDayCount <= 2
      ? 'まずは小さな1件をこなせる日を2日作ろう'
      : '疲れやすい日は軽い回復クエストで流れを切らさないようにしよう',
  ].filter((value): value is string => Boolean(value))

  const strongestSkill = summary.topSkill?.skillName
  const topQuest = summary.topQuestSummaries[0]?.title
  const gentleFocus =
    summary.dailyQuestSummaries.find((entry) => entry.currentDays < entry.previousDays)?.title ??
    summary.dailyQuestSummaries[0]?.title ??
    topQuest

  const commentParts = [
    `今週は${summary.totalCompletionCount}件クリアできて、${summary.activeDayCount}日動けているのがいい流れだよ。`,
    strongestSkill ? `特に${strongestSkill}が伸びていて、積み上げが見えているね。` : undefined,
    gentleFocus ? `来週は${gentleFocus}を続けやすい形に整えることだけ意識すれば十分。` : '来週は負荷を増やすより、続けやすい形をひとつ守ろう。',
  ].filter((value): value is string => Boolean(value))

  return {
    provider: 'template' as const,
    comment: commentParts.join(' '),
    recommendations: recommendations.slice(0, 3),
  }
}

export async function generateWeeklyReflection(params: {
  aiConfig: AiConfig
  settings: UserSettings
  summary: WeeklyReflectionSummary
}) {
  const { aiConfig, settings, summary } = params
  const openAiConfig = aiConfig.providers.openai

  if (!settings.aiEnabled || !openAiConfig.apiKey || isOffline()) {
    return buildWeeklyReflectionFallback(summary)
  }

  try {
    const result = await requestOpenAiJson<{
      comment: string
      recommendations: string[]
    }>({
      apiKey: openAiConfig.apiKey,
      model: OPENAI_MODELS.text,
      schemaName: 'weekly_reflection',
      schema: weeklyReflectionJsonSchema,
      input: {
        task: 'weekly_reflection',
        summary,
      },
      systemPrompt: WEEKLY_REFLECTION_SYSTEM_PROMPT,
    })

    const parsed = weeklyReflectionSchema.parse(result)
    return {
      provider: 'openai' as const,
      comment: parsed.comment,
      recommendations: parsed.recommendations,
    }
  } catch {
    return buildWeeklyReflectionFallback(summary)
  }
}

export interface GeneratedDailyActivityLog {
  provider: 'openai' | 'template'
  summary: string
  questSummary: string
  healthSummary: string
  mainThemes: string[]
  reviewQuestions: string[]
}

export interface GeneratedWeeklyActivityReview {
  provider: 'openai' | 'template'
  summary: string
  focusThemes: string[]
}

function uniqueNonEmpty(values: Array<string | undefined>, limit = 5) {
  const seen = new Set<string>()
  const results: string[] = []

  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    results.push(normalized)
    if (results.length >= limit) {
      break
    }
  }

  return results
}

function takeTopCounts(values: string[], limit = 5) {
  const counts = new Map<string, number>()

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized) {
      continue
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] === left[1]) {
        return left[0].localeCompare(right[0], 'ja')
      }
      return right[1] - left[1]
    })
    .slice(0, limit)
    .map(([value]) => value)
}

function summarizeSessionFocus(sessions: ActivitySession[]) {
  if (sessions.length === 0) {
    return '静かな整理'
  }

  const first = sessions[0]
  const app = first.appNames[0]
  const domain = first.domains[0]

  if (app && domain) {
    return `${app} と ${domain} を行き来する流れ`
  }

  if (first.title) {
    return first.title
  }

  if (app) {
    return `${app} での作業`
  }

  return '静かな整理'
}

function collectThemes(sessions: ActivitySession[], openLoops: OpenLoop[], limit = 5) {
  const sessionThemes = takeTopCounts(
    sessions.flatMap((session) => [
      session.primaryCategory,
      ...session.activityKinds,
      ...session.domains,
      ...session.projectNames,
    ]),
    limit,
  )

  return uniqueNonEmpty(
    [
      ...sessionThemes,
      ...openLoops.map((openLoop) => openLoop.title),
    ],
    limit,
  )
}

function sanitizeSessionsForActionLogAi(sessions: ActivitySession[]) {
  return sessions.map((session) => ({
    sessionId: session.id,
    dateKey: session.dateKey,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    title: session.title,
    primaryCategory: session.primaryCategory,
    activityKinds: session.activityKinds,
    appNames: session.appNames,
    domains: session.domains,
    projectNames: session.projectNames,
    summary: session.summary ?? null,
  }))
}

function sanitizeOpenLoopsForActionLogAi(openLoops: OpenLoop[]) {
  return openLoops.map((openLoop) => ({
    id: openLoop.id,
    dateKey: openLoop.dateKey,
    title: openLoop.title,
    description: openLoop.description ?? null,
    status: openLoop.status,
  }))
}

function sanitizeQuestsForActionLogAi(quests: Quest[]) {
  return quests.map((quest) => ({
    id: quest.id,
    title: quest.title,
    category: quest.category ?? null,
    questType: getQuestTypeLabel(quest),
    status: quest.status,
  }))
}

function sanitizeCompletionsForActionLogAi(completions: QuestCompletion[], questMap: Map<string, Quest>) {
  return completions.map((completion) => ({
    id: completion.id,
    completedAt: completion.completedAt,
    questId: completion.questId,
    questTitle: questMap.get(completion.questId)?.title ?? null,
    note: completion.note ?? null,
  }))
}

function sanitizeHealthDataForActionLogAi(healthData: HealthDataEntry[]) {
  return healthData.map((entry) => ({
    date: entry.date,
    time: entry.time,
    weight_kg: entry.weight_kg,
    body_fat_pct: entry.body_fat_pct,
    source: entry.source ?? null,
  }))
}

function filterOpenOpenLoops(openLoops: OpenLoop[]) {
  return openLoops.filter((openLoop) => openLoop.status === 'open')
}

function filterDateCompletions(dateKey: string, completions: QuestCompletion[]) {
  return getActiveCompletions(completions)
    .filter((completion) => getDayKey(completion.completedAt) === dateKey)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
}

function filterDateHealthData(dateKey: string, healthData: HealthDataEntry[]) {
  return [...healthData]
    .filter((entry) => entry.date === dateKey)
    .sort((left, right) => `${right.date}T${right.time}`.localeCompare(`${left.date}T${left.time}`))
}

function buildQuestSummaryFallback(params: {
  dateKey: string
  quests: Quest[]
  completions: QuestCompletion[]
}) {
  const questMap = new Map(params.quests.map((quest) => [quest.id, quest] as const))
  const sameDayCompletions = filterDateCompletions(params.dateKey, params.completions)

  if (sameDayCompletions.length === 0) {
    return 'リリィは、この日のクエスト達成は控えめで、次の一歩へ向けた静かな余白が残っていたと見ている。'
  }

  const topQuestTitle = questMap.get(sameDayCompletions[0]?.questId ?? '')?.title ?? 'いくつかのクエスト'
  const uniqueTitles = uniqueNonEmpty(
    sameDayCompletions.map((completion) => questMap.get(completion.questId)?.title),
    3,
  )

  return [
    `リリィは、この日は${sameDayCompletions.length}件の達成があり、`,
    `${topQuestTitle}のような区切りが静かに積み重なっていたと見ている。`,
    uniqueTitles.length > 1 ? `${uniqueTitles.slice(1).join('や')}にも小さな足跡が残っていた。` : '',
  ].join('')
}

function buildHealthSummaryFallback(params: {
  dateKey: string
  healthData: HealthDataEntry[]
}) {
  const sameDayHealthData = filterDateHealthData(params.dateKey, params.healthData)
  const latest = sameDayHealthData[0]

  if (!latest) {
    return 'リリィは、この日の健康記録は多く語らず、静かな余白のまま一日の輪郭を見守っていた。'
  }

  const details = [
    latest.weight_kg != null ? `体重 ${latest.weight_kg}kg` : undefined,
    latest.body_fat_pct != null ? `体脂肪率 ${latest.body_fat_pct}%` : undefined,
  ].filter(Boolean)

  if (details.length === 0) {
    return 'リリィは、この日の健康記録が静かに残り、暮らしの輪郭をそっと伝えていたと見ている。'
  }

  return `リリィは、この日の健康記録に${details.join('、')}といった輪郭が残り、朝の様子をそっと伝えていたと見ている。`
}

function buildDailyActivityLogFallback(params: {
  dateKey: string
  sessions: ActivitySession[]
  openLoops: OpenLoop[]
  quests: Quest[]
  completions: QuestCompletion[]
  healthData: HealthDataEntry[]
}): GeneratedDailyActivityLog {
  const themes = collectThemes(params.sessions, params.openLoops, 3)
  const themeText = themes.length > 0 ? themes.join('や') : '静かな整理'
  const focus = summarizeSessionFocus(params.sessions)
  const openLoop = params.openLoops[0]

  return {
    provider: 'template',
    summary: [
      `リリィの観察では、この日は${themeText}を軸に時間が流れていた。`,
      `${focus}に向かう場面が中心で、`,
      openLoop
        ? `${openLoop.title}のように、まだ続きを気にしていることも残っていた。`
        : '区切りをつけながら静かに進めていた。',
    ].join(''),
    questSummary: buildQuestSummaryFallback({
      dateKey: params.dateKey,
      quests: params.quests,
      completions: params.completions,
    }),
    healthSummary: buildHealthSummaryFallback({
      dateKey: params.dateKey,
      healthData: params.healthData,
    }),
    mainThemes: themes.length > 0 ? themes : ['静かな整理'],
    reviewQuestions: [
      `${focus}のあとに、次の一歩として見えていたものは何だったか。`,
      openLoop
        ? `${openLoop.title}に手を戻すなら、最初に確かめたい点はどこか。`
        : 'この日の流れの中で、もう少し深めたい部分はどこだったか。',
    ],
  }
}

function buildWeeklyActivityReviewFallback(params: {
  weekKey: string
  sessions: ActivitySession[]
  openLoops: OpenLoop[]
  categoryDurations: Record<string, number>
}): GeneratedWeeklyActivityReview {
  const themes = collectThemes(params.sessions, params.openLoops, 3)
  const strongestCategory = Object.entries(params.categoryDurations)
    .sort((left, right) => right[1] - left[1])[0]?.[0]
  const openLoop = params.openLoops[0]

  return {
    provider: 'template',
    summary: [
      `リリィの観察では、この週は${themes.join('や') || '静かな整理'}がゆっくり積み重なっていた。`,
      strongestCategory ? `${strongestCategory}に向かう時間が濃く、` : '',
      openLoop
        ? `${openLoop.title}のように、続きを抱えたまま次の週へ渡りそうなものも見えていた。`
        : 'いくつかの区切りをつけながら、流れを整えていた。',
    ].join(''),
    focusThemes: themes.length > 0 ? themes : ['静かな整理'],
  }
}

export async function generateDailyActivityLog(params: {
  aiConfig: AiConfig
  settings: UserSettings
  dateKey: string
  sessions: ActivitySession[]
  openLoops: OpenLoop[]
  quests: Quest[]
  completions: QuestCompletion[]
  healthData: HealthDataEntry[]
}): Promise<GeneratedDailyActivityLog> {
  const { aiConfig, settings, dateKey, sessions, openLoops, quests, completions, healthData } = params
  const openAiConfig = aiConfig.providers.openai
  const visibleOpenLoops = filterOpenOpenLoops(openLoops)
  const sameDayCompletions = filterDateCompletions(dateKey, completions)
  const sameDayHealthData = filterDateHealthData(dateKey, healthData)
  const relatedQuestIds = new Set(sameDayCompletions.map((completion) => completion.questId))
  const relatedQuests = quests.filter((quest) => relatedQuestIds.has(quest.id))

  if (!settings.aiEnabled || !openAiConfig.apiKey || isOffline()) {
    return buildDailyActivityLogFallback({
      dateKey,
      sessions,
      openLoops: visibleOpenLoops,
      quests: relatedQuests,
      completions: sameDayCompletions,
      healthData: sameDayHealthData,
    })
  }

  try {
    const questMap = new Map(relatedQuests.map((quest) => [quest.id, quest] as const))
    const result = await requestOpenAiJson<{
      summary: string
      questSummary: string
      healthSummary: string
      mainThemes: string[]
      reviewQuestions: string[]
    }>({
      apiKey: openAiConfig.apiKey,
      model: OPENAI_MODELS.text,
      schemaName: 'daily_activity_log',
      schema: dailyActivityLogJsonSchema,
      input: {
        task: 'daily_activity_log',
        dateKey,
        sessions: sanitizeSessionsForActionLogAi(sessions),
        openLoops: sanitizeOpenLoopsForActionLogAi(visibleOpenLoops),
        quests: sanitizeQuestsForActionLogAi(relatedQuests),
        completions: sanitizeCompletionsForActionLogAi(sameDayCompletions, questMap),
        healthData: sanitizeHealthDataForActionLogAi(sameDayHealthData),
      },
      systemPrompt: DAILY_ACTIVITY_LOG_SYSTEM_PROMPT,
    })

    const parsed = dailyActivityLogSchema.parse(result)
    return {
      provider: 'openai',
      summary: parsed.summary,
      questSummary: parsed.questSummary,
      healthSummary: parsed.healthSummary,
      mainThemes: parsed.mainThemes,
      reviewQuestions: parsed.reviewQuestions,
    }
  } catch {
    return buildDailyActivityLogFallback({
      dateKey,
      sessions,
      openLoops: visibleOpenLoops,
      quests: relatedQuests,
      completions: sameDayCompletions,
      healthData: sameDayHealthData,
    })
  }
}

export async function generateWeeklyActivityReview(params: {
  aiConfig: AiConfig
  settings: UserSettings
  weekKey: string
  sessions: ActivitySession[]
  openLoops: OpenLoop[]
  categoryDurations: Record<string, number>
}): Promise<GeneratedWeeklyActivityReview> {
  const { aiConfig, settings, weekKey, sessions, openLoops, categoryDurations } = params
  const openAiConfig = aiConfig.providers.openai
  const visibleOpenLoops = filterOpenOpenLoops(openLoops)

  if (!settings.aiEnabled || !openAiConfig.apiKey || isOffline()) {
    return buildWeeklyActivityReviewFallback({
      weekKey,
      sessions,
      openLoops: visibleOpenLoops,
      categoryDurations,
    })
  }

  try {
    const result = await requestOpenAiJson<{
      summary: string
      focusThemes: string[]
    }>({
      apiKey: openAiConfig.apiKey,
      model: OPENAI_MODELS.text,
      schemaName: 'weekly_activity_review',
      schema: weeklyActivityReviewJsonSchema,
      input: {
        task: 'weekly_activity_review',
        weekKey,
        categoryDurations,
        sessions: sanitizeSessionsForActionLogAi(sessions),
        openLoops: sanitizeOpenLoopsForActionLogAi(visibleOpenLoops),
      },
      systemPrompt: WEEKLY_ACTIVITY_REVIEW_SYSTEM_PROMPT,
    })

    const parsed = weeklyActivityReviewSchema.parse(result)
    return {
      provider: 'openai',
      summary: parsed.summary,
      focusThemes: parsed.focusThemes,
    }
  } catch {
    return buildWeeklyActivityReviewFallback({
      weekKey,
      sessions,
      openLoops: visibleOpenLoops,
      categoryDurations,
    })
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${providerConfig.ttsModel}:generateContent`,
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

// ---- Lily チャット (Chat Completions API) ----

const LILY_CHAT_MODEL = 'gpt-5.4'
const MAX_CHAT_HISTORY = 30
const CHAT_COMPLETION_TOKEN_LIMITS = [900, 1600]

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatCompletionResult =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; toolCalls: ToolCall[]; assistantMessage: { role: 'assistant'; content: string | null; tool_calls: ToolCall[] } }

export type ChatToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ChatMessageParam =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

function normalizeOpenAiChatContent(
  content: unknown,
): string | null {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return null
  }

  const text = content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (!part || typeof part !== 'object') {
        return ''
      }

      const textValue = (part as { text?: unknown }).text
      return typeof textValue === 'string' ? textValue : ''
    })
    .filter(Boolean)
    .join('\n')

  return text.length > 0 ? text : null
}

export function buildLilyChatSystemPromptLegacy(params: {
  user: LocalUser
  skills: Skill[]
  quests: Quest[]
  recentCompletions: Array<{ questTitle: string; completedAt: string }>
  activityLogs: ActivityLogEntry[]
}): string {
  const { user, skills, quests, recentCompletions, activityLogs } = params

  const activeSkills = skills.filter((s) => s.status === 'active').sort((a, b) => b.totalXp - a.totalXp)

  const skillDetails = activeSkills.length > 0
    ? activeSkills.map((s) => `- ${s.name}（Lv.${s.level}, XP: ${s.totalXp}, カテゴリ: ${s.category}）`).join('\n')
    : 'まだスキルがありません'

  const activeQuests = quests.filter((q) => q.status === 'active' && q.source !== 'browsing')
  const questList = activeQuests.length > 0
    ? activeQuests.map((q) => {
        const parts = [`- ${q.title}`]
        if (q.category) parts.push(`カテゴリ: ${q.category}`)
        parts.push(`XP: ${q.xpReward}`)
        parts.push(getQuestTypeLabel(q))
        return parts.join('、')
      }).join('\n')
    : 'まだクエストがありません'

  const completionSummary = recentCompletions.length > 0
    ? recentCompletions
        .slice(0, 15)
        .map((c) => `- ${c.questTitle}（${c.completedAt.slice(0, 10)}）`)
        .join('\n')
    : 'まだ完了記録がありません'

  // Aggregate activity logs by category
  const categoryCounts: Record<string, number> = {}
  for (const log of activityLogs) {
    categoryCounts[log.category] = (categoryCounts[log.category] ?? 0) + 1
  }
  const activitySummary = Object.entries(categoryCounts).length > 0
    ? Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, count]) => `${cat}: ${count}回`)
        .join('、')
    : 'まだアクティビティがありません'

  return [
    'あなたの名前はリリィです。自分育成アプリの温かく励ます成長パートナーです。',
    'ユーザーの名前は峰生（みねお）です。',
    '日本語で会話してください。',
    'アニメのヒロインのようなフレンドリーな口調で話してください。「です・ます」調は使わず、「〜だよ」「〜だね」「〜しようね」「〜いこうね」のような親しみのあるタメ口で話してください。',
    '応答は100〜200文字程度に収めてください。',
    'ユーザーの成長を具体的に認め、押し付けがましくならない程度の提案をしてください。',
    'ログにない情報を推測で語らないでください。',
    '',
    `【ユーザー情報】`,
    `- レベル: ${user.level}`,
    `- 総XP: ${user.totalXp}`,
    '',
    `【スキル一覧】`,
    skillDetails,
    '',
    `【登録中のクエスト】`,
    questList,
    '',
    `【直近7日のアクティビティ（カテゴリ別）】`,
    activitySummary,
    '',
    `【直近のクエスト完了】`,
    completionSummary,
    '',
    `【利用可能なツール】`,
    `あなたはツールを使ってユーザーの詳細情報を取得できます。上記の要約で不足する場合や、具体的な質問を受けた場合に積極的に使ってください。`,
    `- get_browsing_times: Web閲覧時間データ（カテゴリ別・サイト別）`,
    `- get_health_data: 体重・体脂肪率データ。date / fromDate / toDate / period が使える。`,
    `- get_user_info: プロフィール(type=profile)、設定(type=settings)、メタ情報(type=meta)`,
    `- get_quest_data: クエスト一覧(type=quests)、完了記録(type=completions)。フィルタ: status, questType, category, period, questId`,
    `- get_skill_data: スキル一覧(type=skills)、個人スキル辞書(type=dictionary)。フィルタ: status, category`,
    `- get_messages_and_logs: 過去のメッセージ(type=assistant_messages)、AI設定(type=ai_config)、操作ログ(type=activity_logs)、チャット履歴(type=chat_sessions/chat_messages)`,
  ].join('\n')
}

export function buildLilyChatSystemPrompt(params: {
  user: LocalUser
  skills: Skill[]
  quests: Quest[]
  recentCompletions: Array<{ questTitle: string; completedAt: string }>
  activityLogs: ActivityLogEntry[]
}): string {
  const { user, skills, quests, recentCompletions, activityLogs } = params

  const activeSkills = skills
    .filter((skill) => skill.status === 'active')
    .sort((left, right) => right.totalXp - left.totalXp)

  const skillDetails = activeSkills.length > 0
    ? activeSkills
        .map(
          (skill) =>
            `- ${skill.name}（Lv.${skill.level}, XP: ${skill.totalXp}, カテゴリ: ${skill.category || '未分類'}）`,
        )
        .join('\n')
    : 'まだスキルがありません'

  const activeQuests = quests.filter((quest) => quest.status === 'active' && quest.source !== 'browsing')
  const questList = activeQuests.length > 0
    ? activeQuests
        .map((quest) => {
          const parts = [`- ${quest.title}`]
          if (quest.category) parts.push(`カテゴリ: ${quest.category}`)
          parts.push(`XP: ${quest.xpReward}`)
          parts.push(getQuestTypeLabel(quest))
          return parts.join('、')
        })
        .join('\n')
    : 'まだクエストがありません'

  const completionSummary = recentCompletions.length > 0
    ? recentCompletions
        .slice(0, 15)
        .map((completion) => `- ${completion.questTitle}（${completion.completedAt.slice(0, 10)}）`)
        .join('\n')
    : 'まだ完了記録がありません'

  const categoryCounts: Record<string, number> = {}
  for (const log of activityLogs) {
    categoryCounts[log.category] = (categoryCounts[log.category] ?? 0) + 1
  }
  const activitySummary = Object.entries(categoryCounts).length > 0
    ? Object.entries(categoryCounts)
        .sort((left, right) => right[1] - left[1])
        .map(([category, count]) => `${category}: ${count}回`)
        .join('、')
    : 'まだアクティビティがありません'

  // Keep this aligned with lily_desktop/ai/system_prompts.py::build_lily_system_prompt.
  // The web app intentionally omits desktop-only Haruka context and JSON/pose output instructions.
  return [
    'あなたの名前はリリィです。自分育成アプリの温かく励ます成長パートナーです。',
    'ユーザーの名前は峰生（みねお）です。',
    '日本語で会話してください。',
    'アニメのヒロインのようなフレンドリーな口調で話してください。「です・ます」調は使わず、「〜だよ」「〜だね」「〜しようね」「〜いこうね」のような親しみのあるタメ口で話してください。',
    '応答は100〜200文字程度に収めてください。',
    'ユーザーの成長を具体的に認め、押し付けがましくならない程度の提案をしてください。',
    'ログにない情報を推測で語らないでください。',
    'ツールで確認できることは推測せず、必要なときは先に取得してください。',
    '強調のための ** や ### などのMarkdown記法は使わず、基本はプレーンテキストで自然に話してください。',
    '自然な改行は使っていいですが、箇条書きはユーザーが一覧や要約を求めたときだけにしてください。',
    '明示日付の扱いは必ず JST 固定です。3/29、3月29日、2026-03-29 のような指定は JST の YYYY-MM-DD に正規化して date 引数を使ってください。',
    'fromDate / toDate も JST の YYYY-MM-DD です。明示日付があるときは period=today/week/month を使わず、date または fromDate / toDate を優先してください。',
    'today / week / month は明示日付がないときだけ使ってください。',
    '特定日の会話内容・本文・要約を聞かれたら、まず get_messages_and_logs の type=chat_messages を date 付きで呼んで本文を取りに行ってください。',
    'chat_sessions はセッション一覧を知りたいときや追加で絞り込みたいときだけ使ってください。本文が必要な質問で chat_sessions の結果だけを返して止まらないでください。',
    'クエスト完了の発話は、漢字・ひらがな・カタカナの表記ゆれや言い換え、近いニュアンスの差を許容して解釈してください。complete_quest を使うときは、最も近いクエストを表す短い検索クエリに言い換えて構いません。',
    '',
    '【ユーザー情報】',
    `- レベル: ${user.level}`,
    `- 総XP: ${user.totalXp}`,
    '',
    '【スキル一覧】',
    skillDetails,
    '',
    '【登録中のクエスト】',
    questList,
    '',
    '【直近7日のアクティビティ（カテゴリ別）】',
    activitySummary,
    '',
    '【直近のクエスト完了】',
    completionSummary,
    '',
    '【利用可能なツール】',
    'あなたはツールを使ってユーザーの詳細情報を取得できます。上記の要約で不足する場合や、具体的な質問を受けた場合に積極的に使ってください。',
    '- get_browsing_times: Web閲覧時間。date / fromDate / toDate / period が使える。',
    '- get_health_data: 体重・体脂肪率データ。date / fromDate / toDate / period が使える。',
    '- get_user_info: プロフィール(type=profile)、設定(type=settings)、メタ情報(type=meta)。',
    '- get_quest_data: クエスト一覧(type=quests) と完了履歴(type=completions)。completions では date / fromDate / toDate / period / questId が使える。',
    '- get_skill_data: スキル一覧(type=skills) と個人スキル辞書(type=dictionary)。',
    '- get_messages_and_logs: アシスタントメッセージ、AI設定、活動ログ、状況ログ、チャットセッション、チャット本文。date / fromDate / toDate / period が使える。type=chat_messages は date / fromDate / toDate があれば sessionId なしで全セッション横断検索できる。',
    '- get_nutrition_data: 栄養素摂取データ（16栄養素）。date / fromDate / toDate / period が使える。デフォルトは今日。',
  ].join('\n')
}

export async function sendLilyChatMessage(params: {
  apiKey: string
  messages: ChatMessageParam[]
  tools?: ChatToolDefinition[]
}): Promise<ChatCompletionResult> {
  const { apiKey, messages, tools } = params

  // Limit conversation history (keep system prompt + last N messages)
  const systemMessages = messages.filter((m) => m.role === 'system')
  const conversationMessages = messages.filter((m) => m.role !== 'system')
  const trimmedConversation = conversationMessages.slice(-MAX_CHAT_HISTORY)
  const finalMessages = [...systemMessages, ...trimmedConversation]

  let lastError: Error | undefined

  for (const maxCompletionTokens of CHAT_COMPLETION_TOKEN_LIMITS) {
    const body: Record<string, unknown> = {
      model: LILY_CHAT_MODEL,
      messages: finalMessages,
      max_completion_tokens: maxCompletionTokens,
    }
    if (tools && tools.length > 0) {
      body.tools = tools
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const details = await readErrorResponse(response)
        lastError = new Error(
          `OpenAI Chat request failed: ${response.status}${details ? ` - ${details}` : ''}`,
        )

        if (attempt < 3 && isRetryableStatus(response.status)) {
          await wait(300 * attempt)
          continue
        }

        throw lastError
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: { content?: unknown; tool_calls?: ToolCall[] }
          finish_reason?: string
        }>
      }

      const message = payload.choices?.[0]?.message
      const finishReason = payload.choices?.[0]?.finish_reason
      const toolCalls = message?.tool_calls
      const content = normalizeOpenAiChatContent(message?.content)

      if (toolCalls && toolCalls.length > 0) {
        return {
          type: 'tool_calls',
          toolCalls,
          assistantMessage: {
            role: 'assistant',
            content,
            tool_calls: toolCalls,
          },
        }
      }

      if (!content) {
        if (finishReason === 'length') {
          lastError = new Error('OpenAI Chat response was truncated before text was returned.')
          break
        }
        throw new Error('OpenAI Chat response was empty.')
      }

      return { type: 'text', content }
    }
  }

  throw lastError ?? new Error('OpenAI Chat request failed.')
}
