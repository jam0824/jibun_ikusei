import type { BrowsingCategory, ClassificationResult, PageInfo } from '@ext/types/browsing'
import { isGrowthCategory } from '@ext/types/browsing'
import type { ExtensionSettings } from '@ext/types/settings'
import { buildCacheKey } from '@ext/lib/cache-key'
import CLASSIFICATION_SYSTEM_PROMPT from '@ext/lib/classification-prompt.txt?raw'

const OPENAI_MODEL = 'gpt-5.4'
const GEMINI_MODEL = 'gemini-2.5-flash'
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504])

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: {
      type: 'string',
      enum: ['学習', '仕事', '健康', '生活', '創作', '対人', '娯楽', 'その他'],
    },
    isGrowth: { type: 'boolean' },
    confidence: { type: 'number' },
    suggestedQuestTitle: { type: 'string' },
    suggestedSkill: { type: 'string' },
  },
  required: ['category', 'isGrowth', 'confidence', 'suggestedQuestTitle', 'suggestedSkill'],
}

interface AiClassificationResult {
  category: BrowsingCategory
  isGrowth: boolean
  confidence: number
  suggestedQuestTitle: string
  suggestedSkill: string
}

function createFallbackResult(pageInfo: PageInfo): ClassificationResult {
  return {
    category: 'その他',
    isGrowth: false,
    confidence: 0,
    suggestedQuestTitle: pageInfo.title || 'ブラウジング',
    suggestedSkill: '',
    cacheKey: buildCacheKey(pageInfo),
  }
}

// --- OpenAI ---

function extractOpenAiText(payload: Record<string, unknown>): string {
  const outputText = payload.output_text
  if (typeof outputText === 'string' && outputText.trim()) {
    return outputText
  }

  const output = Array.isArray(payload.output) ? payload.output : []

  for (const item of output) {
    if (typeof item !== 'object' || !item) continue
    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? ((item as { content?: unknown[] }).content ?? [])
      : []

    for (const fragment of content) {
      if (typeof fragment !== 'object' || !fragment) continue
      const rec = fragment as { text?: string; refusal?: string }
      if (typeof rec.text === 'string' && rec.text.trim()) return rec.text
      if (typeof rec.refusal === 'string' && rec.refusal.trim()) {
        throw new Error(`OpenAI refused: ${rec.refusal}`)
      }
    }
  }

  throw new Error('OpenAI response text was empty.')
}

async function requestOpenAi(apiKey: string, pageInfo: PageInfo): Promise<AiClassificationResult> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: CLASSIFICATION_SYSTEM_PROMPT }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify(pageInfo) }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'browsing_classification',
            schema: CLASSIFICATION_SCHEMA,
            strict: true,
          },
        },
        max_output_tokens: 300,
      }),
    })

    if (!response.ok) {
      lastError = new Error(`OpenAI failed: ${response.status}`)
      if (attempt < 3 && RETRYABLE_STATUS_CODES.has(response.status)) {
        await new Promise((r) => setTimeout(r, 300 * attempt))
        continue
      }
      throw lastError
    }

    const payload = (await response.json()) as Record<string, unknown>
    const rawText = extractOpenAiText(payload)
    return JSON.parse(rawText) as AiClassificationResult
  }

  throw lastError ?? new Error('OpenAI request failed.')
}

// --- Gemini ---

async function requestGemini(apiKey: string, pageInfo: PageInfo): Promise<AiClassificationResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CLASSIFICATION_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(pageInfo) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: CLASSIFICATION_SCHEMA,
        },
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`Gemini failed: ${response.status}`)
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini response text was empty.')
  return JSON.parse(text) as AiClassificationResult
}

// --- Public API ---

export async function classifyPage(
  pageInfo: PageInfo,
  settings: ExtensionSettings,
): Promise<ClassificationResult> {
  const cacheKey = buildCacheKey(pageInfo)

  // Check if we have a usable API key
  const apiKey =
    settings.aiProvider === 'openai' ? settings.openaiApiKey : settings.geminiApiKey
  if (!apiKey) {
    return createFallbackResult(pageInfo)
  }

  try {
    const raw =
      settings.aiProvider === 'openai'
        ? await requestOpenAi(apiKey, pageInfo)
        : await requestGemini(apiKey, pageInfo)

    return {
      category: raw.category,
      isGrowth: isGrowthCategory(raw.category),
      confidence: raw.confidence,
      suggestedQuestTitle: raw.suggestedQuestTitle,
      suggestedSkill: raw.suggestedSkill,
      cacheKey,
    }
  } catch {
    return createFallbackResult(pageInfo)
  }
}
