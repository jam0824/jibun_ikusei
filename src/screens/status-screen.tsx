import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Globe, Heart, Settings2, Sparkles, Utensils } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { QuestCompleteModal } from '@/components/quest-complete-modal'
import { QuestCard } from '@/components/quest-card'
import { Screen, SectionHeader } from '@/components/layout'
import { Badge, Button, Card, CardContent, Progress } from '@/components/ui'
import { getQuestAvailability, getStatusView, getWeeklyReflectionStatus } from '@/domain/logic'
import { resolveDayNutrition } from '@/domain/nutrition-logic'
import type { BrowsingTimeData, FitbitSummary, NutritionDayResult } from '@/lib/api-client'
import { getBrowsingTimes } from '@/lib/api-client'
import { formatDateTime, getDayKey } from '@/lib/date'
import { formatSeconds } from '@/lib/time-format'
import { useAppStore } from '@/store/app-store'

type AsyncDataState<T> = {
  loading: boolean
  error: boolean
  data?: T
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return hours > 0 ? `${hours}時間${mins}分` : `${mins}分`
}

function summarizeBrowsing(entries: BrowsingTimeData[]) {
  return entries.reduce(
    (summary, entry) => {
      for (const domain of Object.values(entry.domains)) {
        if (domain.isGrowth) {
          summary.growthSeconds += domain.totalSeconds
        } else {
          summary.otherSeconds += domain.totalSeconds
        }
      }

      return summary
    },
    { growthSeconds: 0, otherSeconds: 0 },
  )
}

function summarizeNutrition(dayData?: NutritionDayResult) {
  if (!dayData) {
    return undefined
  }

  const meals = [dayData.breakfast, dayData.lunch, dayData.dinner].filter(
    (record): record is NonNullable<typeof record> => record !== null,
  )
  if (!dayData.daily && meals.length === 0) {
    return undefined
  }

  const resolved = resolveDayNutrition(dayData.daily, meals)
  const counts = Object.values(resolved.nutrients).reduce(
    (summary, entry) => {
      if (entry.label === '不足') {
        summary.low += 1
      } else if (entry.label === '適正') {
        summary.ok += 1
      } else if (entry.label === '過剰') {
        summary.high += 1
      }

      return summary
    },
    { low: 0, ok: 0, high: 0 },
  )

  return counts
}

function SupplementCard({
  icon,
  title,
  lines,
}: {
  icon: ReactNode
  title: string
  lines: string[]
}) {
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            {icon}
          </div>
          {title}
        </div>
        <div className="mt-3 space-y-1 text-sm text-slate-600">
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function StatusScreen() {
  const navigate = useNavigate()
  const todayKey = useMemo(() => getDayKey(new Date()), [])
  const {
    quests,
    completions,
    skills,
    meta,
    fetchNutrition,
    fetchFitbit,
    nutritionCache,
    fitbitCache,
    completeQuest,
  } = useAppStore(
    useShallow((state) => ({
      quests: state.quests,
      completions: state.completions,
      skills: state.skills,
      meta: state.meta,
      fetchNutrition: state.fetchNutrition,
      fetchFitbit: state.fetchFitbit,
      nutritionCache: state.nutritionCache,
      fitbitCache: state.fitbitCache,
      completeQuest: state.completeQuest,
    })),
  )

  const state = useAppStore()
  const statusView = useMemo(() => getStatusView(state), [state])
  const weeklyReflectionStatus = useMemo(
    () => getWeeklyReflectionStatus({ quests, completions, skills, meta }),
    [completions, meta, quests, skills],
  )
  const [activeQuestId, setActiveQuestId] = useState<string>()
  const [nutritionState, setNutritionState] = useState<AsyncDataState<NutritionDayResult>>({
    loading: true,
    error: false,
  })
  const [healthState, setHealthState] = useState<AsyncDataState<FitbitSummary | null>>({
    loading: true,
    error: false,
  })
  const [browsingState, setBrowsingState] = useState<
    AsyncDataState<{ growthSeconds: number; otherSeconds: number }>
  >({
    loading: true,
    error: false,
  })

  useEffect(() => {
    let cancelled = false

    setNutritionState({ loading: true, error: false })
    fetchNutrition(todayKey)
      .then((data) => {
        if (!cancelled) {
          setNutritionState({ loading: false, error: false, data })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNutritionState({ loading: false, error: true })
        }
      })

    setHealthState({ loading: true, error: false })
    fetchFitbit(todayKey)
      .then((data) => {
        if (!cancelled) {
          setHealthState({ loading: false, error: false, data })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealthState({ loading: false, error: true })
        }
      })

    setBrowsingState({ loading: true, error: false })
    getBrowsingTimes(todayKey, todayKey)
      .then((data) => {
        if (!cancelled) {
          setBrowsingState({
            loading: false,
            error: false,
            data: summarizeBrowsing(data),
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrowsingState({ loading: false, error: true })
        }
      })

    return () => {
      cancelled = true
    }
  }, [fetchFitbit, fetchNutrition, todayKey])

  const activeQuest = activeQuestId
    ? statusView.recommendedQuests.find((quest) => quest.id === activeQuestId)
    : undefined
  const latestMessageText =
    statusView.latestMessage?.text ??
    '今の流れを見ながら、次の一手を整えていきましょう。'
  const nutritionSummary = summarizeNutrition(nutritionState.data ?? nutritionCache[todayKey])
  const healthData = healthState.data ?? fitbitCache[todayKey]

  const healthLines = healthState.error
    ? ['健康データを取得できませんでした']
    : healthState.loading
      ? ['読み込み中...']
      : healthData?.activity || healthData?.sleep?.main_sleep || healthData?.heart
        ? [
            healthData?.activity?.steps !== null && healthData?.activity?.steps !== undefined
              ? `${healthData.activity.steps.toLocaleString()} 歩`
              : '歩数データなし',
            healthData?.sleep?.main_sleep
              ? `${formatMinutes(healthData.sleep.main_sleep.minutes_asleep)}`
              : '睡眠データなし',
            healthData?.heart?.resting_heart_rate !== null &&
              healthData?.heart?.resting_heart_rate !== undefined
              ? `${healthData.heart.resting_heart_rate} bpm`
              : '安静時心拍データなし',
          ]
        : ['健康データはまだありません']

  const nutritionLines = nutritionState.error
    ? ['栄養データを取得できませんでした']
    : nutritionState.loading
      ? ['読み込み中...']
      : nutritionSummary
        ? [
            `不足 ${nutritionSummary.low}件`,
            `適正 ${nutritionSummary.ok}件`,
            `過剰 ${nutritionSummary.high}件`,
          ]
        : ['栄養データはまだありません']

  const browsingLines = browsingState.error
    ? ['閲覧データを取得できませんでした']
    : browsingState.loading
      ? ['読み込み中...']
      : browsingState.data &&
          (browsingState.data.growthSeconds > 0 || browsingState.data.otherSeconds > 0)
        ? [
            `成長系 ${formatSeconds(browsingState.data.growthSeconds)}`,
            `その他 ${formatSeconds(browsingState.data.otherSeconds)}`,
          ]
        : ['閲覧データはまだありません']

  return (
    <Screen
      title="ステータス"
      subtitle="今の自分の流れを一覧で確認できます。"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <Card className="overflow-hidden border-0 bg-slate-900 text-white shadow-xl shadow-slate-200">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">Status</div>
              <div className="mt-2 text-4xl font-black tracking-tight">Lv.{statusView.userLevel}</div>
              <div className="mt-1 text-sm text-white/70">
                次のレベルまであと {statusView.nextLevelXp}XP
              </div>
            </div>
            <div className="rounded-2xl bg-white/10 px-3 py-2 text-right">
              <div className="text-[10px] text-white/55">Total XP</div>
              <div className="text-xl font-semibold">{statusView.totalXp}</div>
            </div>
          </div>
          <Progress value={statusView.levelProgress} className="mt-4 h-2 bg-white/10" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className="bg-white/12 text-white hover:bg-white/12">連続 {statusView.streakDays}日</Badge>
            <Badge className="bg-white/12 text-white hover:bg-white/12">
              {statusView.currentType.label ?? statusView.currentType.placeholder}
            </Badge>
          </div>
          <div className="mt-4 rounded-2xl bg-white/10 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="h-4 w-4 text-violet-200" />
              Lily のひとこと
            </div>
            <div className="mt-2 text-sm leading-6 text-white/80">{latestMessageText}</div>
          </div>
        </CardContent>
      </Card>

      <section className="mt-5">
        <SectionHeader title="六系統" />
        <div className="grid grid-cols-2 gap-3">
          {statusView.primaryCategories.map((entry) => (
            <Card key={entry.category} className="h-full">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{entry.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{entry.representativeSkill?.name ?? '代表スキルなし'}</div>
                  </div>
                  <Badge>Lv.{entry.level}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-2xl bg-slate-50 px-3 py-3">
                    <div className="text-xs text-slate-500">累積XP</div>
                    <div className="mt-1 font-semibold text-slate-900">{entry.totalXp}XP</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-3">
                    <div className="text-xs text-slate-500">直近7日</div>
                    <div className="mt-1 font-semibold text-slate-900">+{entry.recentXp}XP</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <SectionHeader title="最近の伸び" />
        {statusView.topGrowthCategories.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-slate-500">
              直近7日の成長がまだありません。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {statusView.topGrowthCategories.map((entry) => (
              <Card key={entry.category}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{entry.label}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {entry.representativeSkill?.name ?? '代表スキルなし'}
                    </div>
                  </div>
                  <Badge>+{entry.recentXp}XP</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mt-5">
        <SectionHeader title="今日のコンディション" />
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">今日のクリア</div>
              <div className="mt-1 text-xl font-black text-slate-900">
                {statusView.condition.todayCompletionCount}回
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">今日の獲得XP</div>
              <div className="mt-1 text-xl font-black text-slate-900">
                {statusView.condition.todayUserXp >= 0 ? '+' : ''}
                {statusView.condition.todayUserXp}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">今週の行動日数</div>
              <div className="mt-1 text-xl font-black text-slate-900">
                {statusView.condition.weekActionDays}日
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">直近の達成時刻</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {statusView.condition.latestCompletionAt
                  ? formatDateTime(statusView.condition.latestCompletionAt, 'M/d HH:mm')
                  : 'まだありません'}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <SupplementCard icon={<Heart className="h-4 w-4" />} title="健康" lines={healthLines} />
          <SupplementCard icon={<Utensils className="h-4 w-4" />} title="栄養" lines={nutritionLines} />
          <SupplementCard icon={<Globe className="h-4 w-4" />} title="閲覧" lines={browsingLines} />
        </div>
      </section>

      {statusView.otherCategory ? (
        <section className="mt-5">
          <SectionHeader title="その他の成長" />
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-slate-900">
                累積 {statusView.otherCategory.totalXp}XP
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {statusView.otherCategory.skills.map((skill) => (
                  <Badge key={skill.id} tone="outline">
                    {skill.name}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="mt-5 pb-6">
        <SectionHeader title="次の一手" />
        {weeklyReflectionStatus.available && weeklyReflectionStatus.unread ? (
          <Card className="mb-3 border-amber-200 bg-amber-50">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-900">先週のふりかえり</div>
                  <Badge tone="warning">未読</Badge>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  良かった流れを見直して、次の一手を整えよう。
                </div>
              </div>
              <Button size="sm" onClick={() => navigate('/weekly-reflection')}>
                確認
              </Button>
            </CardContent>
          </Card>
        ) : null}
        {statusView.recommendedQuests.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-slate-500">
              今おすすめできるクエストはありません。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {statusView.recommendedQuests.map((quest) => {
              const availability = getQuestAvailability(quest, completions)
              const skill = skills.find(
                (entry) => entry.id === (quest.fixedSkillId ?? quest.defaultSkillId),
              )
              const actionLabel = availability.canComplete
                ? 'クリア'
                : quest.status === 'completed'
                  ? '再オープン'
                  : '編集'

              return (
                <QuestCard
                  key={quest.id}
                  quest={quest}
                  availability={availability}
                  skill={skill}
                  actionLabel={actionLabel}
                  onAction={() => {
                    if (availability.canComplete) {
                      setActiveQuestId(quest.id)
                      return
                    }

                    if (quest.status === 'completed') {
                      useAppStore.getState().reopenQuest(quest.id)
                      return
                    }

                    navigate(`/quests/new?edit=${quest.id}`)
                  }}
                  onOpen={() => navigate(`/quests/new?edit=${quest.id}`)}
                />
              )
            })}
          </div>
        )}
      </section>

      {activeQuest ? (
        <QuestCompleteModal
          quest={activeQuest}
          onClose={() => setActiveQuestId(undefined)}
          onComplete={async (payload) => {
            const result = await completeQuest(activeQuest.id, {
              ...payload,
              sourceScreen: 'home',
            })
            if (result.completionId) {
              setActiveQuestId(undefined)
              navigate(`/clear/${result.completionId}`)
            }
          }}
        />
      ) : null}
    </Screen>
  )
}
