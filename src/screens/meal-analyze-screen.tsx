import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Screen } from '@/components/layout'
import { Button, Card, CardContent } from '@/components/ui'

type AnalyzeState = 'idle' | 'analyzing'

const MEAL_TYPE_LABELS: Record<string, string> = {
  daily: '1日分',
  breakfast: '朝',
  lunch: '昼',
  dinner: '夜',
}

export function MealAnalyzeScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') ?? 'daily'
  const date = searchParams.get('date') ?? ''

  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>('idle')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (analyzeState !== 'analyzing') return
    const timer = setTimeout(() => {
      navigate(`/meal/confirm?type=${type}&date=${date}`)
    }, 2000)
    return () => clearTimeout(timer)
  }, [analyzeState, navigate, type, date])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }

  const handleAnalyze = () => {
    setAnalyzeState('analyzing')
  }

  const mealLabel = MEAL_TYPE_LABELS[type] ?? type

  return (
    <Screen title={`${mealLabel} を登録`} subtitle={date}>
      {analyzeState === 'analyzing' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
          <div className="text-sm font-medium text-slate-600">解析中...</div>
          <div className="text-xs text-slate-400">スクリーンショットから栄養素を抽出しています</div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 画像選択エリア */}
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">スクリーンショット</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full"
          >
            <Card className="hover:border-violet-200 hover:bg-violet-50/40 transition">
              <CardContent className="flex flex-col items-center justify-center gap-3 p-8">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="選択した画像"
                    className="max-h-64 w-full rounded-xl object-contain"
                  />
                ) : (
                  <>
                    <div className="text-3xl text-slate-300">📸</div>
                    <div className="text-sm font-medium text-slate-500">タップして画像を選択</div>
                    <div className="text-xs text-slate-400">栄養素アプリのスクリーンショット（任意）</div>
                  </>
                )}
              </CardContent>
            </Card>
          </button>

          {/* エラー表示スロット（Phase 2 で使用） */}
          <div id="analyze-error-slot" />

          {/* 解析ボタン */}
          <div className="sticky bottom-[84px] pt-2">
            <Button className="w-full" onClick={handleAnalyze}>
              解析する（モック）
            </Button>
          </div>
        </div>
      )}
    </Screen>
  )
}
