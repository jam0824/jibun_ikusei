import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Screen } from '@/components/layout'
import { Button, Card, CardContent } from '@/components/ui'
import { analyzeNutritionImage, fileToBase64, NutritionAnalyzeError } from '@/lib/nutrition-analyzer'
import { useAppStore } from '@/store/app-store'
import type { NutrientMap } from '@/domain/types'


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

  const aiConfig = useAppStore((s) => s.aiConfig)
  const openaiConfig = aiConfig.providers.openai

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // APIキー未設定の場合はワーニング表示
  const hasApiKey = Boolean(openaiConfig?.apiKey)

  // ファイル選択解除時にプレビューURLを解放
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setErrorMessage(null)
  }

  const handleAnalyze = async () => {
    if (!selectedFile) {
      setErrorMessage('画像を選択してください')
      return
    }
    if (!hasApiKey) {
      setErrorMessage('OpenAI APIキーが設定されていません。設定画面から登録してください。')
      return
    }

    setIsAnalyzing(true)
    setErrorMessage(null)

    try {
      const { base64, mimeType } = await fileToBase64(selectedFile)
      const nutrients: NutrientMap = await analyzeNutritionImage(
        base64,
        mimeType,
        openaiConfig.apiKey!,
        openaiConfig.model,
      )
      navigate(`/meal/confirm?type=${type}&date=${date}`, {
        state: { nutrients },
      })
    } catch (err) {
      const message =
        err instanceof NutritionAnalyzeError
          ? err.message
          : '解析中に予期せぬエラーが発生しました。もう一度お試しください。'
      setErrorMessage(message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const mealLabel = MEAL_TYPE_LABELS[type] ?? type

  return (
    <Screen title={`${mealLabel} を登録`} subtitle={date}>
      {isAnalyzing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
          <div className="text-sm font-medium text-slate-600">解析中...</div>
          <div className="text-xs text-slate-400">スクリーンショットから栄養素を抽出しています</div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* APIキー未設定の警告 */}
          {!hasApiKey && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
              OpenAI APIキーが未設定です。設定画面から登録してください。
            </div>
          )}

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
                    <div className="text-xs text-slate-400">栄養素アプリの「1日分」スクリーンショット</div>
                  </>
                )}
              </CardContent>
            </Card>
          </button>

          {/* エラー表示 */}
          {errorMessage && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          )}

          {/* 解析ボタン */}
          <div className="sticky bottom-[84px] pt-2">
            <Button
              className="w-full"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              解析する
            </Button>
          </div>
        </div>
      )}
    </Screen>
  )
}
