import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { Screen } from '@/components/layout'
import { Badge, Card, CardContent } from '@/components/ui'
import { useAppStore } from '@/store/app-store'

type MealType = 'daily' | 'breakfast' | 'lunch' | 'dinner'

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  daily: '1日分',
  breakfast: '朝',
  lunch: '昼',
  dinner: '夜',
}

const MEAL_TYPES: MealType[] = ['daily', 'breakfast', 'lunch', 'dinner']

function getTodayJst(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function MealRegisterScreen() {
  const navigate = useNavigate()
  const [date, setDate] = useState(getTodayJst())
  const [isLoading, setIsLoading] = useState(false)

  const { fetchNutrition, nutritionCache } = useAppStore(
    useShallow((s) => ({ fetchNutrition: s.fetchNutrition, nutritionCache: s.nutritionCache }))
  )

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setIsLoading(true)
      fetchNutrition(date)
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) {
            setIsLoading(false)
          }
        })
    })

    return () => {
      cancelled = true
    }
  }, [date, fetchNutrition])

  const dayData = nutritionCache[date]

  const handleMealTypeClick = (type: MealType) => {
    navigate(`/meal/analyze?type=${type}&date=${date}`)
  }

  return (
    <Screen title="食事登録" subtitle="栄養素を記録する">
      {/* 日付選択 */}
      <div className="mb-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">登録日</div>
        <Card>
          <CardContent className="p-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl bg-transparent text-base font-semibold text-slate-900 focus:outline-none"
            />
          </CardContent>
        </Card>
      </div>

      {/* 区分カード */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">登録区分</div>
      <div className="space-y-3">
        {MEAL_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className="w-full text-left transition"
            onClick={() => handleMealTypeClick(type)}
          >
            <Card className="hover:border-violet-200 hover:bg-violet-50/40">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="text-sm font-semibold text-slate-900">{MEAL_TYPE_LABELS[type]}</div>
                  {isLoading ? (
                    <span className="inline-block rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-400">確認中...</span>
                  ) : dayData?.[type] ? (
                    <span className="inline-block rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">登録済み</span>
                  ) : (
                    <Badge tone="outline">未登録</Badge>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </Screen>
  )
}
