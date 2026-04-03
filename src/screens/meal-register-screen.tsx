import { useState } from 'react'
import { ChevronRight, ListTodo, Utensils } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout'
import { Badge, Card, CardContent } from '@/components/ui'

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

  const handleMealTypeClick = (type: MealType) => {
    navigate(`/meal/analyze?type=${type}&date=${date}`)
  }

  return (
    <Screen title="食事登録" subtitle="栄養素を記録する">
      {/* タブバー */}
      <div className="mb-4 flex gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => navigate('/quests/new')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition text-slate-500 hover:text-slate-700"
        >
          <ListTodo className="h-3.5 w-3.5" />
          クエスト追加
        </button>
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition bg-white text-slate-900 shadow-sm"
        >
          <Utensils className="h-3.5 w-3.5" />
          食事登録
        </button>
      </div>

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
                  <Badge tone="outline">未登録</Badge>
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
