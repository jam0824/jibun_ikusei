import { z } from 'zod'
import { NUTRIENT_META } from '@/domain/nutrition-constants'
import type { NutrientMap } from '@/domain/types'

// ---------------------------------------------------------------
// プロンプト
// ---------------------------------------------------------------

const SYSTEM_PROMPT = `あなたは栄養管理アプリのスクリーンショット解析の専門家です。
スマートフォンの栄養管理アプリのスクリーンショットから16栄養素の情報を抽出し、JSON形式で返してください。

【処理条件】
- 「1日分」タブが表示されているスクリーンショットのみ処理してください
- 16栄養素すべての一覧が確認できる場合のみ処理してください
- 上記条件を満たさない場合は isValid: false を返してください

【抽出する16栄養素のキー】
energy(エネルギー), protein(たんぱく質), fat(脂質), carbs(糖質),
potassium(カリウム), calcium(カルシウム), iron(鉄), vitaminA(ビタミンA),
vitaminE(ビタミンE), vitaminB1(ビタミンB1), vitaminB2(ビタミンB2),
vitaminB6(ビタミンB6), vitaminC(ビタミンC), fiber(食物繊維),
saturatedFat(飽和脂肪酸), salt(塩分)

【基準値の判定種別】
- "〜"を含む場合: type = "range"、lower = 下限の数値、upper = 上限の数値
- "以上"を含む場合: type = "min_only"、lower = 数値
- "未満"または"以下"を含む場合: type = "max_only"、upper = 数値
- 基準値が読み取れない場合: threshold = null

【ラベル】
- 画像に表示されているラベルをそのまま抽出: "不足" / "適正" / "過剰"
- 読み取れない場合: null

【出力形式（isValid: true の例）】
{
  "isValid": true,
  "nutrients": {
    "energy": { "value": 1822, "label": "不足", "threshold": { "type": "range", "lower": 1839, "upper": 2239 } },
    "protein": { "value": 83.3, "label": "適正", "threshold": { "type": "range", "lower": 73.8, "upper": 178.4 } },
    "potassium": { "value": 1704, "label": "不足", "threshold": { "type": "min_only", "lower": 3000 } },
    "salt": { "value": 7.1, "label": "適正", "threshold": { "type": "max_only", "upper": 7.5 } }
  }
}

【出力形式（isValid: false の例）】
{
  "isValid": false,
  "errorReason": "「1日分」の表示が確認できません"
}

数値は単位を除いた数値のみを返してください。必ずJSON形式のみを返してください。`

// ---------------------------------------------------------------
// Zodスキーマ
// ---------------------------------------------------------------

const ThresholdSchema = z.object({
  type: z.enum(['range', 'min_only', 'max_only']),
  lower: z.number().optional(),
  upper: z.number().optional(),
})

const NutrientResultSchema = z.object({
  value: z.number().nullable(),
  label: z.enum(['不足', '適正', '過剰']).nullable(),
  threshold: ThresholdSchema.nullable(),
})

const NutrientKeySchema = z.object({
  energy: NutrientResultSchema,
  protein: NutrientResultSchema,
  fat: NutrientResultSchema,
  carbs: NutrientResultSchema,
  potassium: NutrientResultSchema,
  calcium: NutrientResultSchema,
  iron: NutrientResultSchema,
  vitaminA: NutrientResultSchema,
  vitaminE: NutrientResultSchema,
  vitaminB1: NutrientResultSchema,
  vitaminB2: NutrientResultSchema,
  vitaminB6: NutrientResultSchema,
  vitaminC: NutrientResultSchema,
  fiber: NutrientResultSchema,
  saturatedFat: NutrientResultSchema,
  salt: NutrientResultSchema,
})

const AnalysisSuccessSchema = z.object({
  isValid: z.literal(true),
  nutrients: NutrientKeySchema,
})

const AnalysisFailureSchema = z.object({
  isValid: z.literal(false),
  errorReason: z.string(),
})

const AnalysisResponseSchema = z.union([AnalysisSuccessSchema, AnalysisFailureSchema])

// ---------------------------------------------------------------
// メイン関数
// ---------------------------------------------------------------

export class NutritionAnalyzeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NutritionAnalyzeError'
  }
}

/**
 * 画像のbase64文字列（data:プレフィックスなし）を受け取り、
 * OpenAI Vision APIで解析して NutrientMap を返す
 */
export async function analyzeNutritionImage(
  base64Image: string,
  mimeType: string,
  apiKey: string,
  model: string,
): Promise<NutrientMap> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: 'この栄養管理アプリのスクリーンショットから16栄養素の情報を抽出してください。',
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 2000,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new NutritionAnalyzeError(`APIエラー: ${response.status} ${text.slice(0, 200)}`)
  }

  const json = await response.json()
  const content: string = json.choices?.[0]?.message?.content ?? ''

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new NutritionAnalyzeError('AIの応答をJSONとして解析できませんでした')
  }

  const result = AnalysisResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new NutritionAnalyzeError(`応答の形式が正しくありません: ${result.error.issues[0]?.message}`)
  }

  if (!result.data.isValid) {
    throw new NutritionAnalyzeError(result.data.errorReason)
  }

  // NutrientResult → NutrientEntry（単位を付加）
  const unitMap = Object.fromEntries(NUTRIENT_META.map((m) => [m.key, m.unit]))
  const nutrients = result.data.nutrients
  return Object.fromEntries(
    Object.entries(nutrients).map(([key, entry]) => [
      key,
      {
        value: entry.value,
        unit: unitMap[key] ?? '',
        label: entry.label,
        threshold: entry.threshold ?? null,
      },
    ]),
  ) as NutrientMap
}

// ---------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------

/** File → base64文字列（プレフィックスなし）に変換 */
export function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // "data:image/jpeg;base64,XXXX" → ["data:image/jpeg;base64", "XXXX"]
      const [prefix, base64] = result.split(',')
      const mimeType = prefix.split(':')[1].split(';')[0]
      resolve({ base64, mimeType })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
