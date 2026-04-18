import { useMemo, useState } from 'react'
import { MessageCircle, Play, Plus, Settings2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  getLevelFromXp,
  getQuestAvailability,
  getRecommendedQuests,
  getTodayActiveCompletions,
  getWeeklyReflectionStatus,
} from '@/domain/logic'
import { QuestCompleteModal } from '@/components/quest-complete-modal'
import { QuestCard } from '@/components/quest-card'
import { EmptyState, Screen, SectionHeader } from '@/components/layout'
import { Badge, Button, Card, CardContent, Progress } from '@/components/ui'
import { useAppStore } from '@/store/app-store'

export function HomeScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    user,
    quests,
    completions,
    skills,
    assistantMessages,
    meta,
    completeQuest,
    playAssistantMessage,
  } = useAppStore(
    useShallow((state) => ({
      user: state.user,
      quests: state.quests,
      completions: state.completions,
      skills: state.skills,
      assistantMessages: state.assistantMessages,
      meta: state.meta,
      completeQuest: state.completeQuest,
      playAssistantMessage: state.playAssistantMessage,
    })),
  )
  const [audioError, setAudioError] = useState<string>()

  const levelInfo = useMemo(() => getLevelFromXp(user.totalXp, 100), [user.totalXp])
  const todayCompletions = useMemo(() => getTodayActiveCompletions(completions), [completions])
  const todayXp = todayCompletions.reduce(
    (sum, completion) => sum + completion.userXpAwarded,
    0,
  )
  const topSkills = skills.filter((skill) => skill.status === 'active').slice(0, 3)
  const recommendedQuests = getRecommendedQuests(quests, completions)
  const latestMessage = useMemo(
    () =>
      [...assistantMessages].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )[0],
    [assistantMessages],
  )
  const weeklyReflectionStatus = useMemo(
    () => getWeeklyReflectionStatus({ quests, completions, skills, meta }),
    [completions, meta, quests, skills],
  )

  const activeQuestId = searchParams.get('complete')
  const activeQuest = activeQuestId
    ? quests.find((quest) => quest.id === activeQuestId)
    : undefined

  const handlePlayMessage = async (messageId: string) => {
    const error = await playAssistantMessage(messageId)
    setAudioError(error)
  }

  if (quests.length === 0) {
    return (
      <Screen
        title="ホーム"
        subtitle="今日の進捗と次の一手をここから確認できます。"
        action={
          <Button size="icon" onClick={() => navigate('/settings')}>
            <Settings2 className="h-5 w-5" />
          </Button>
        }
      >
        <EmptyState
          title="最初のクエストを追加しましょう"
          description="読書や運動など、続けたい行動をクエストとして登録するとホームからすぐに取り組めます。"
          action={
            <Button onClick={() => navigate('/quests/new')}>
              <Plus className="h-4 w-4" />
              クエストを追加
            </Button>
          }
        />
      </Screen>
    )
  }

  return (
    <Screen
      title="ホーム"
      subtitle="今日やることと今日の記録をまとめて見られます。"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <section>
        <SectionHeader title="今日のサマリー" />
        <Card className="overflow-hidden border-0 bg-slate-900 text-white shadow-xl shadow-slate-200">
          <CardContent className="p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">
                  Today
                </div>
                <div className="mt-2 text-4xl font-black tracking-tight">Lv.{levelInfo.level}</div>
                <div className="mt-1 text-sm text-white/70">
                  次のレベルまであと {levelInfo.nextStepXp}XP
                </div>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-2 text-right">
                <div className="text-[10px] text-white/55">Today XP</div>
                <div className="text-xl font-semibold">
                  {todayXp >= 0 ? '+' : ''}
                  {todayXp}
                </div>
              </div>
            </div>
            <Progress value={levelInfo.progress} className="h-2 bg-white/10" />
            <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
              <button
                type="button"
                aria-label="今日のクリア回数を記録で見る"
                className="rounded-2xl bg-white/10 px-2 py-3 text-left transition hover:bg-white/15"
                onClick={() => navigate('/records/growth?range=today')}
              >
                <div className="text-white/60">今日のクリア</div>
                <div className="mt-1 text-lg font-semibold">{todayCompletions.length}回</div>
              </button>
              <div className="rounded-2xl bg-white/10 px-2 py-3">
                <div className="text-white/60">伸びているスキル</div>
                <div className="mt-1 text-sm font-semibold">
                  {topSkills[0]?.name ?? 'まだなし'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {weeklyReflectionStatus.available && weeklyReflectionStatus.unread ? (
        <section className="mt-5">
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-900">先週のふりかえり</div>
                  <Badge tone="warning">未読</Badge>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  良かった流れを見つけて、来週の整え方を軽く決めよう。
                </div>
              </div>
              <Button
                size="sm"
                className="whitespace-nowrap"
                aria-label="先週のふりかえりを確認"
                onClick={() => navigate('/records/review/weekly')}
              >
                確認
              </Button>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="mt-5">
        <SectionHeader title="Lily" />
        <Card className="border-violet-100 bg-white">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <img
                src={`${import.meta.env.BASE_URL}lily/face.png`}
                alt="リリィ"
                className="h-13 w-13 shrink-0 rounded-2xl object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-900">最新コメント</div>
                  <Badge>ナビゲーター</Badge>
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  {latestMessage?.text ??
                    '今日の達成を積み重ねると、ここにLilyのコメントが表示されます。'}
                </div>
              </div>
              {latestMessage ? (
                <Button
                  size="icon"
                  variant="secondary"
                  className="rounded-2xl"
                  onClick={() => void handlePlayMessage(latestMessage.id)}
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
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="text-violet-600"
                onClick={() => navigate('/lily')}
              >
                <MessageCircle className="mr-1 h-4 w-4" />
                リリィと話す
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5 pb-6">
        <SectionHeader
          title="今日のクエスト"
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate('/records')}>
              成長記録を見る
            </Button>
          }
        />
        <div className="space-y-3">
          {recommendedQuests.map((quest) => {
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
                    const next = new URLSearchParams(searchParams)
                    next.set('complete', quest.id)
                    setSearchParams(next)
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
      </section>

      {activeQuest ? (
        <QuestCompleteModal
          quest={activeQuest}
          onClose={() => {
            const next = new URLSearchParams(searchParams)
            next.delete('complete')
            setSearchParams(next)
          }}
          onComplete={async (payload) => {
            const result = await completeQuest(activeQuest.id, {
              ...payload,
              sourceScreen: 'home',
            })
            if (result.completionId) {
              const next = new URLSearchParams(searchParams)
              next.delete('complete')
              setSearchParams(next)
              navigate(`/clear/${result.completionId}`)
            }
          }}
        />
      ) : null}
    </Screen>
  )
}
