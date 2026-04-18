import { Activity, Heart, ScrollText, Settings2, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Screen, SectionHeader } from '@/components/layout'
import { Button, Card, CardContent } from '@/components/ui'

function getTodayJst(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function RecordsHubScreen() {
  const navigate = useNavigate()
  const today = getTodayJst()

  return (
    <Screen
      title="記録"
      subtitle="見返したい記録の入口をここにまとめています。"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <section>
        <SectionHeader title="記録の入口" />
        <div className="grid gap-3">
          <button
            type="button"
            className="text-left"
            onClick={() => navigate('/records/growth?range=today')}
          >
            <Card className="hover:border-violet-200 hover:bg-violet-50/40">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                  <ScrollText className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">成長記録</div>
                  <div className="mt-1 text-sm text-slate-500">
                    今日・今週・累計のクエスト記録を見返せます。
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>

          <button
            type="button"
            className="text-left"
            onClick={() => navigate('/records/activity/today')}
          >
            <Card className="hover:border-violet-200 hover:bg-violet-50/40">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">行動ログ</div>
                  <div className="mt-1 text-sm text-slate-500">
                    今日の行動、検索、カレンダー、週次レビューを確認できます。
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>

          <button
            type="button"
            className="text-left"
            onClick={() => navigate(`/records/life/nutrition?date=${today}`)}
          >
            <Card className="hover:border-violet-200 hover:bg-violet-50/40">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <Heart className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">生活ログ</div>
                  <div className="mt-1 text-sm text-slate-500">
                    栄養、健康、閲覧の記録を見返せます。
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>

          <button
            type="button"
            className="text-left"
            onClick={() => navigate('/records/review/weekly')}
          >
            <Card className="hover:border-violet-200 hover:bg-violet-50/40">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">週次ふりかえり</div>
                  <div className="mt-1 text-sm text-slate-500">
                    先週の流れを見直して、次の一手を整えられます。
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        </div>
      </section>
    </Screen>
  )
}
