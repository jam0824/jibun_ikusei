import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Screen } from '@/components/layout'
import { Button, Card, CardContent } from '@/components/ui'

type NutrientLabel = '不足' | '適正' | '過剰'

interface MockNutrient {
  name: string
  value: number
  unit: string
  label: NutrientLabel
  threshold: string
}

const MEAL_TYPE_LABELS: Record<string, string> = {
  daily: '1日分',
  breakfast: '朝',
  lunch: '昼',
  dinner: '夜',
}

const MOCK_NUTRIENTS: MockNutrient[] = [
  { name: 'エネルギー', value: 1822,  unit: 'kcal', label: '不足', threshold: '1839〜2239' },
  { name: 'たんぱく質', value: 83.3,  unit: 'g',    label: '適正', threshold: '73.8〜178.4' },
  { name: '脂質',       value: 68.2,  unit: 'g',    label: '適正', threshold: '56.6〜79.3' },
  { name: '糖質',       value: 224.4, unit: 'g',    label: '適正', threshold: '152.9〜254.9' },
  { name: 'カリウム',   value: 1704,  unit: 'mg',   label: '不足', threshold: '3000以上' },
  { name: 'カルシウム', value: 472,   unit: 'mg',   label: '不足', threshold: '750〜2500' },
  { name: '鉄',         value: 13.7,  unit: 'mg',   label: '適正', threshold: '7.5以上' },
  { name: 'ビタミンA',  value: 2977,  unit: 'µg',   label: '過剰', threshold: '900〜2700' },
  { name: 'ビタミンE',  value: 17,    unit: 'mg',   label: '適正', threshold: '6.5〜800' },
  { name: 'ビタミンB1', value: 3.5,   unit: 'mg',   label: '適正', threshold: '1以上' },
  { name: 'ビタミンB2', value: 3.59,  unit: 'mg',   label: '適正', threshold: '1.4以上' },
  { name: 'ビタミンB6', value: 4.47,  unit: 'mg',   label: '適正', threshold: '1.5〜60' },
  { name: 'ビタミンC',  value: 136,   unit: 'mg',   label: '適正', threshold: '100以上' },
  { name: '食物繊維',   value: 14.5,  unit: 'g',    label: '不足', threshold: '22以上' },
  { name: '飽和脂肪酸', value: 17.77, unit: 'g',    label: '過剰', threshold: '15.86未満' },
  { name: '塩分',       value: 7.1,   unit: 'g',    label: '適正', threshold: '7.5未満' },
]

const LABEL_STYLES: Record<NutrientLabel, string> = {
  '不足': 'bg-blue-50 text-blue-700 border border-blue-200',
  '適正': 'bg-green-50 text-green-700 border border-green-200',
  '過剰': 'bg-rose-50 text-rose-700 border border-rose-200',
}

export function MealConfirmScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') ?? 'daily'
  const date = searchParams.get('date') ?? ''

  const [values, setValues] = useState<number[]>(MOCK_NUTRIENTS.map((n) => n.value))

  const mealLabel = MEAL_TYPE_LABELS[type] ?? type

  const handleSave = () => {
    alert('保存しました（モック）')
    navigate('/meal')
  }

  return (
    <Screen title={`${mealLabel} 確認`} subtitle={date}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        解析結果（摂取量のみ編集可）
      </div>

      <div className="space-y-2 pb-32">
        {MOCK_NUTRIENTS.map((nutrient, i) => (
          <Card key={nutrient.name}>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                {/* 栄養素名 + ラベル */}
                <div className="w-28 shrink-0">
                  <div className="text-xs font-semibold text-slate-900">{nutrient.name}</div>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${LABEL_STYLES[nutrient.label]}`}>
                    {nutrient.label}
                  </span>
                </div>

                {/* 摂取量 入力 */}
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="number"
                    value={values[i]}
                    onChange={(e) => {
                      const next = [...values]
                      next[i] = Number(e.target.value)
                      setValues(next)
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-violet-400 focus:outline-none"
                  />
                  <span className="shrink-0 text-xs text-slate-500">{nutrient.unit}</span>
                </div>

                {/* 基準値 */}
                <div className="w-24 shrink-0 text-right text-[10px] leading-4 text-slate-400">
                  {nutrient.threshold}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 保存ボタン（固定フッター） */}
      <div className="fixed bottom-[84px] left-0 right-0 px-4 py-2 bg-white/90 backdrop-blur border-t border-slate-100">
        <div className="mx-auto max-w-3xl">
          <Button className="w-full" onClick={handleSave}>
            保存する
          </Button>
        </div>
      </div>
    </Screen>
  )
}
