import { useEffect, useMemo, useState } from 'react'
import { Play, ScrollText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent } from '@/components/ui'
import { getPreviousWeekReflectionSummary } from '@/domain/logic'
import { useAppStore } from '@/store/app-store'

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-1 text-lg font-black text-slate-900">{value}</div>
      </CardContent>
    </Card>
  )
}

function RecordsActionButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="icon"
      variant="outline"
      className="rounded-2xl"
      aria-label="記録"
      onClick={onClick}
    >
      <ScrollText className="h-5 w-5" />
    </Button>
  )
}

export function WeeklyReflectionScreen() {
  const navigate = useNavigate()
  const {
    quests,
    completions,
    skills,
    assistantMessages,
    meta,
    ensureWeeklyReflection,
    playAssistantMessage,
  } = useAppStore(
    useShallow((state) => ({
      quests: state.quests,
      completions: state.completions,
      skills: state.skills,
      assistantMessages: state.assistantMessages,
      meta: state.meta,
      ensureWeeklyReflection: state.ensureWeeklyReflection,
      playAssistantMessage: state.playAssistantMessage,
    })),
  )
  const [isLoading, setIsLoading] = useState(true)
  const [audioError, setAudioError] = useState<string>()

  const summary = useMemo(
    () => getPreviousWeekReflectionSummary({ quests, completions, skills }),
    [completions, quests, skills],
  )
  const reflection =
    meta.latestWeeklyReflection?.weekKey === summary.weekKey ? meta.latestWeeklyReflection : undefined
  const reflectionMessage = assistantMessages.find(
    (entry) => entry.triggerType === 'weekly_reflection' && entry.periodKey === summary.weekKey,
  )

  useEffect(() => {
    let active = true

    void ensureWeeklyReflection()
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [ensureWeeklyReflection])

  const handlePlay = async () => {
    if (!reflectionMessage) {
      return
    }

    const error = await playAssistantMessage(reflectionMessage.id)
    setAudioError(error)
  }

  if (isLoading && !reflection && !summary.hasData) {
    return (
      <Screen
        title="週次ふりかえり"
        subtitle="先週の流れをまとめています。"
        action={
          <RecordsActionButton onClick={() => navigate('/records?filter=week')} />
        }
      >
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            ふりかえりを準備しています...
          </CardContent>
        </Card>
      </Screen>
    )
  }

  if (!summary.hasData) {
    return (
      <Screen
        title="週次ふりかえり"
        subtitle="先週の流れをまとめます。"
        action={
          <RecordsActionButton onClick={() => navigate('/records?filter=week')} />
        }
      >
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-600">
            先週はクエスト記録がありませんでした。来週は小さな 1 件から始めましょう。
          </CardContent>
        </Card>
      </Screen>
    )
  }

  return (
    <Screen
      title="週次ふりかえり"
      subtitle="先週の良かった流れを見つけて、来週を少しだけ整えます。"
      action={
        <RecordsActionButton onClick={() => navigate('/records?filter=week')} />
      }
    >
      <Card>
        <CardContent className="p-5">
          <div className="text-xl font-black text-slate-900">{`${summary.weekLabel} のふりかえり`}</div>
          <div className="mt-2 text-sm text-slate-500">先週のクエスト記録だけをまとめています。</div>
        </CardContent>
      </Card>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <SummaryMetric label="クリア数" value={`${summary.totalCompletionCount}件`} />
        <SummaryMetric label="獲得 User XP" value={`+${summary.totalUserXp}`} />
        <SummaryMetric label="行動した日数" value={`${summary.activeDayCount}日`} />
        <SummaryMetric label="今週いちばん伸びたスキル" value={summary.topSkill?.skillName ?? 'なし'} />
      </section>

      <section className="mt-5">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-slate-900">7日サマリー</div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {summary.dailySummaries.map((entry) => (
                <div key={entry.dayKey} className="rounded-2xl bg-slate-50 px-2 py-3 text-center">
                  <div className="text-xs text-slate-500">{entry.label}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{entry.completionCount}件</div>
                  <div className="mt-1 text-[11px] text-slate-500">+{entry.userXp}XP</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-slate-900">デイリー継続状況</div>
            <div className="mt-3 space-y-3">
              {summary.dailyQuestSummaries.length === 0 ? (
                <div className="text-sm text-slate-500">対象のデイリークエストはありません。</div>
              ) : (
                summary.dailyQuestSummaries.map((entry) => (
                  <div key={entry.questId} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                    <div className="text-sm font-semibold text-slate-900">{entry.title}</div>
                    <div className="text-xs text-slate-500">{`今週 ${entry.currentDays}日 / 先週 ${entry.previousDays}日`}</div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-slate-900">今週の主役クエスト</div>
            <div className="mt-3 space-y-3">
              {summary.topQuestSummaries.map((entry) => (
                <div key={entry.questId} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">{entry.title}</div>
                  <div className="text-xs text-slate-500">{`今週 ${entry.currentCount}回 / 先週 ${entry.previousCount}回`}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-slate-900">今週伸びたスキル</div>
            <div className="mt-3 space-y-3">
              {summary.topSkillSummaries.map((entry) => (
                <div key={entry.skillId} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">{entry.skillName}</div>
                  <Badge>{`+${entry.currentXp} XP`}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5 pb-6">
        <Card className="border-violet-100 bg-white">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Lily コメント</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  {reflection?.comment ?? 'ふりかえりコメントをまとめています。'}
                </div>
              </div>
              {reflectionMessage ? (
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Lilyコメントを再生"
                  onClick={() => void handlePlay()}
                >
                  <Play className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            {audioError ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {audioError}
              </div>
            ) : null}
            <div className="mt-4 text-sm font-semibold text-slate-900">来週のおすすめ</div>
            <div className="mt-3 space-y-2">
              {(reflection?.recommendations ?? []).map((entry) => (
                <div key={entry} className="rounded-2xl bg-violet-50 px-3 py-3 text-sm text-violet-900">
                  {entry}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </Screen>
  )
}
