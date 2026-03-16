import { useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, Clock3, PencilLine, Sparkles, X } from 'lucide-react'
import type { Quest } from '@/domain/types'
import { fromRelativeOption } from '@/lib/date'
import { Badge, Button, Card, CardContent, Textarea } from '@/components/ui'

const timeOptions = [
  { label: '今', value: 'now' as const },
  { label: '5分前', value: 'minus_5m' as const },
  { label: '30分前', value: 'minus_30m' as const },
  { label: 'カスタム', value: 'custom' as const },
]

export function QuestCompleteModal({
  quest,
  onClose,
  onComplete,
}: {
  quest: Quest
  onClose: () => void
  onComplete: (payload: { note?: string; completedAt: string }) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [timeOption, setTimeOption] = useState<(typeof timeOptions)[number]['value']>('now')
  const [customTime, setCustomTime] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const completedAt = useMemo(
    () => fromRelativeOption(timeOption, customTime || undefined),
    [customTime, timeOption],
  )

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-950/35 p-4 backdrop-blur-[2px] sm:items-center">
      <Card className="w-full max-w-md overflow-hidden border-0 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quest Complete</div>
              <div className="mt-1 text-lg font-bold text-slate-900">完了を記録</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-2xl text-slate-500 hover:bg-slate-200"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <CardContent className="space-y-5 p-5">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-base font-semibold text-slate-900">{quest.title}</div>
                  <Badge tone="soft">+{quest.xpReward}XP</Badge>
                </div>
                <div className="mt-1 text-sm text-slate-500">{quest.description || '説明はまだありません'}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {quest.category ? <Badge>{quest.category}</Badge> : null}
                  <Badge tone="outline">{quest.questType === 'repeatable' ? '繰り返し' : '単発'}</Badge>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Clock3 className="h-4 w-4 text-slate-500" />
              完了時刻
            </div>
            <div className="flex flex-wrap gap-2">
              {timeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTimeOption(option.value)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    timeOption === option.value
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {timeOption === 'custom' ? (
              <input
                type="datetime-local"
                value={customTime}
                onChange={(event) => setCustomTime(event.target.value)}
                className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900"
              />
            ) : null}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <PencilLine className="h-4 w-4 text-slate-500" />
              メモ
            </div>
            <Textarea
              placeholder="感じたこと、工夫したこと、次に試したいこと"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-violet-900">クリア後の流れ</div>
                <div className="mt-1 text-sm leading-6 text-violet-700">
                  まず User XP を加算し、そのあとにスキル判定と Lily のコメントを更新します。
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button variant="outline" className="h-12" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              className="h-12"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true)
                try {
                  await onComplete({
                    note: note.trim() || undefined,
                    completedAt,
                  })
                } finally {
                  setSubmitting(false)
                }
              }}
            >
              <CheckCircle2 className="h-4 w-4" />
              クリアする
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
