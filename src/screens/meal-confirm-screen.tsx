import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { Screen } from '@/components/layout'
import { Button, Card, CardContent } from '@/components/ui'
import { DEFAULT_DAILY_NUTRIENT_THRESHOLDS, NUTRIENT_META } from '@/domain/nutrition-constants'
import { useAppStore } from '@/store/app-store'
import { nowIso } from '@/lib/date'
import type { MealType, NutrientKey, NutrientLabel, NutrientMap, NutritionRecord } from '@/domain/types'

const MEAL_TYPE_LABELS: Record<string, string> = {
  daily: '1日分',
  breakfast: '朝',
  lunch: '昼',
  dinner: '夜',
}

// フォールバック用モックデータ（meal_screenshot.png の実測値）
const MOCK_NUTRIENT_MAP: NutrientMap = {
  energy:       { value: 1822,  unit: 'kcal', label: '不足', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.energy },
  protein:      { value: 83.3,  unit: 'g',    label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.protein },
  fat:          { value: 68.2,  unit: 'g',    label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.fat },
  carbs:        { value: 224.4, unit: 'g',    label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.carbs },
  potassium:    { value: 1704,  unit: 'mg',   label: '不足', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.potassium },
  calcium:      { value: 472,   unit: 'mg',   label: '不足', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.calcium },
  iron:         { value: 13.7,  unit: 'mg',   label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.iron },
  vitaminA:     { value: 2977,  unit: 'µg',   label: '過剰', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.vitaminA },
  vitaminE:     { value: 17,    unit: 'mg',   label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.vitaminE },
  vitaminB1:    { value: 3.5,   unit: 'mg',   label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.vitaminB1 },
  vitaminB2:    { value: 3.59,  unit: 'mg',   label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.vitaminB2 },
  vitaminB6:    { value: 4.47,  unit: 'mg',   label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.vitaminB6 },
  vitaminC:     { value: 136,   unit: 'mg',   label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.vitaminC },
  fiber:        { value: 14.5,  unit: 'g',    label: '不足', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.fiber },
  saturatedFat: { value: 17.77, unit: 'g',    label: '過剰', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.saturatedFat },
  salt:         { value: 7.1,   unit: 'g',    label: '適正', threshold: DEFAULT_DAILY_NUTRIENT_THRESHOLDS.salt },
}

const LABEL_STYLES: Record<NutrientLabel, string> = {
  '不足': 'bg-blue-50 text-blue-700 border border-blue-200',
  '適正': 'bg-green-50 text-green-700 border border-green-200',
  '過剰': 'bg-rose-50 text-rose-700 border border-rose-200',
}

function formatThreshold(entry: NutrientMap[NutrientKey]): string {
  const t = entry.threshold
  if (!t) return ''
  if (t.type === 'range' && t.lower !== undefined && t.upper !== undefined) {
    return `${t.lower}〜${t.upper}`
  }
  if (t.type === 'min_only' && t.lower !== undefined) {
    return `${t.lower}以上`
  }
  if (t.type === 'max_only' && t.upper !== undefined) {
    return `${t.upper}未満`
  }
  return ''
}

export function MealConfirmScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const type = (searchParams.get('type') ?? 'daily') as MealType
  const date = searchParams.get('date') ?? ''

  const { fetchNutrition, saveNutrition, nutritionCache, quests, completeQuest } = useAppStore(
    useShallow((s) => ({
      fetchNutrition: s.fetchNutrition,
      saveNutrition: s.saveNutrition,
      nutritionCache: s.nutritionCache,
      quests: s.quests,
      completeQuest: s.completeQuest,
    }))
  )

  // 解析結果を location.state から受け取る。なければモックデータ使用
  const sourceNutrients: NutrientMap = location.state?.nutrients ?? MOCK_NUTRIENT_MAP
  const isMock = !location.state?.nutrients

  // 編集用 state（摂取量のみ）
  const [values, setValues] = useState<Record<NutrientKey, number | null>>(
    () => Object.fromEntries(
      NUTRIENT_META.map((m) => [m.key, sourceNutrients[m.key].value])
    ) as Record<NutrientKey, number | null>
  )

  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const mealLabel = MEAL_TYPE_LABELS[type] ?? type

  const handleSave = async () => {
    // 上書き確認：当日のデータがキャッシュか API にある場合
    const cached = nutritionCache[date]
    const existingRecord: NutritionRecord | null = cached?.[type] ?? null

    // キャッシュにない場合は API から確認
    let hasExisting = Boolean(existingRecord)
    if (!hasExisting && date) {
      try {
        const fetched = await fetchNutrition(date)
        hasExisting = Boolean(fetched[type])
      } catch {
        // fetch 失敗時はそのまま保存続行
      }
    }

    if (hasExisting) {
      const confirmed = window.confirm(
        `${date} の「${mealLabel}」データが既に存在します。上書きしますか？`
      )
      if (!confirmed) return
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      // 編集済み摂取量を nutrients に反映してから保存
      const nutrients: NutrientMap = Object.fromEntries(
        NUTRIENT_META.map((m) => [
          m.key,
          {
            ...sourceNutrients[m.key],
            value: values[m.key],
          },
        ])
      ) as NutrientMap

      await saveNutrition(date, type, {
        date,
        mealType: type,
        nutrients,
        createdAt: existingRecord?.createdAt,
        updatedAt: new Date().toISOString(),
      } as Omit<NutritionRecord, 'userId'>)

      // 食事登録クエストをクリア
      const mealQuest = quests.find((q) => q.systemKey === 'meal_register' && q.status === 'active')
      if (mealQuest) {
        const { completionId } = await completeQuest(mealQuest.id, {
          completedAt: nowIso(),
          sourceScreen: 'meal',
        })
        if (completionId) {
          navigate(`/clear/${completionId}`)
          return
        }
      }

      navigate('/meal')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Screen title={`${mealLabel} 確認`} subtitle={date}>
      {isMock && (
        <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          モックデータを表示しています（解析結果がない場合のフォールバック）
        </div>
      )}

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        解析結果（摂取量のみ編集可）
      </div>

      <div className="space-y-2 pb-32">
        {NUTRIENT_META.map((meta) => {
          const entry = sourceNutrients[meta.key]
          const currentValue = values[meta.key]

          return (
            <Card key={meta.key}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  {/* 栄養素名 + ラベル */}
                  <div className="w-28 shrink-0">
                    <div className="text-xs font-semibold text-slate-900">{meta.name}</div>
                    {entry.label ? (
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${LABEL_STYLES[entry.label]}`}>
                        {entry.label}
                      </span>
                    ) : (
                      <span className="mt-1 inline-block rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-400">
                        未取得
                      </span>
                    )}
                  </div>

                  {/* 摂取量 入力 */}
                  <div className="flex flex-1 items-center gap-1">
                    {currentValue !== null ? (
                      <input
                        type="number"
                        value={currentValue}
                        onChange={(e) => {
                          setValues((prev) => ({ ...prev, [meta.key]: Number(e.target.value) }))
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-violet-400 focus:outline-none"
                      />
                    ) : (
                      <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-sm text-slate-400">
                        未取得
                      </div>
                    )}
                    <span className="shrink-0 text-xs text-slate-500">{meta.unit}</span>
                  </div>

                  {/* 基準値 */}
                  <div className="w-24 shrink-0 text-right text-[10px] leading-4 text-slate-400">
                    {formatThreshold(entry)}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {saveError && (
        <div className="fixed bottom-[144px] left-0 right-0 px-4">
          <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {saveError}
          </div>
        </div>
      )}

      {/* 保存ボタン（固定フッター） */}
      <div className="fixed bottom-[84px] left-0 right-0 border-t border-slate-100 bg-white/90 px-4 py-2 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <Button className="w-full" onClick={handleSave} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存する'}
          </Button>
        </div>
      </div>
    </Screen>
  )
}
