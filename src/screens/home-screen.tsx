import { useMemo, useState } from 'react'
import {
  ChevronRight,
  MessageCircle,
  Play,
  Plus,
  Settings2,
  Target,
  Trophy,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  getLevelFromXp,
  getQuestAvailability,
  getTodayActiveCompletions,
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
    settings,
    completeQuest,
    playAssistantMessage,
  } = useAppStore(
    useShallow((state) => ({
      user: state.user,
      quests: state.quests,
      completions: state.completions,
      skills: state.skills,
      assistantMessages: state.assistantMessages,
      settings: state.settings,
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
  const recommendedQuests = [...quests]
    .filter((quest) => quest.status !== 'archived' && quest.source !== 'browsing')
    .sort((left, right) => {
      const leftAvailability = getQuestAvailability(left, completions)
      const rightAvailability = getQuestAvailability(right, completions)
      const leftScore =
        (left.pinned ? 100 : 0) + (leftAvailability.canComplete ? 20 : 0) + left.xpReward
      const rightScore =
        (right.pinned ? 100 : 0) + (rightAvailability.canComplete ? 20 : 0) + right.xpReward
      return rightScore - leftScore
    })
    .slice(0, 5)

  const latestMessage = useMemo(
    () =>
      [...assistantMessages].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )[0],
    [assistantMessages],
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
        subtitle="今日の進捗とクエストをまとめて確認できます。"
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
      subtitle="今日の進捗とクエストをまとめて確認できます。"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <Card className="overflow-hidden border-0 bg-slate-900 text-white shadow-xl shadow-slate-200">
        <CardContent className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">
                User Level
              </div>
              <div className="mt-2 text-4xl font-black tracking-tight">Lv.{levelInfo.level}</div>
              <div className="mt-1 text-sm text-white/70">
                次のレベルまであと {levelInfo.nextStepXp}XP
              </div>
            </div>
            <div className="rounded-2xl bg-white/10 px-3 py-2 text-right">
              <div className="text-[10px] text-white/55">Total XP</div>
              <div className="text-xl font-semibold">{user.totalXp}</div>
            </div>
          </div>
          <Progress value={levelInfo.progress} className="h-2 bg-white/10" />
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-2xl bg-white/10 px-2 py-3">
              <div className="text-white/60">今日のXP</div>
              <div className="mt-1 text-lg font-semibold">{todayXp >= 0 ? '+' : ''}{todayXp}</div>
            </div>
            <div className="rounded-2xl bg-white/10 px-2 py-3">
              <div className="text-white/60">クリア回数</div>
              <div className="mt-1 text-lg font-semibold">{todayCompletions.length}回</div>
            </div>
            <div className="rounded-2xl bg-white/10 px-2 py-3">
              <div className="text-white/60">音声</div>
              <div className="mt-1 text-lg font-semibold">
                {settings.lilyAutoPlay === 'off' ? 'OFF' : 'ON'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="mt-5">
        <SectionHeader title="今日のサマリー" />
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            aria-label="今日のクリア回数を記録で見る"
            className="text-left transition"
            onClick={() => navigate('/records?filter=today')}
          >
            <Card className="h-full hover:border-violet-200 hover:bg-violet-50/40">
              <CardContent className="p-4">
                <div className="text-xs text-slate-500">今日のクリア</div>
                <div className="mt-1 text-xl font-black text-slate-900">
                  {todayCompletions.length}回
                </div>
              </CardContent>
            </Card>
          </button>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">獲得XP</div>
              <div className="mt-1 text-xl font-black text-slate-900">+{todayXp}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">伸びているスキル</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {topSkills[0]?.name ?? 'まだなし'}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mt-5">
        <SectionHeader title="Lily" />
        <Card className="border-violet-100 bg-white">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <img src={`${import.meta.env.BASE_URL}lily/face.png`} alt="リリィ" className="h-11 w-11 shrink-0 rounded-2xl object-cover" />
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

      <section className="mt-5">
        <SectionHeader
          title="今日のクエスト"
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate('/quests')}>
              すべて見る
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

      <section className="mt-5">
        <SectionHeader title="クイックアクション" />
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            className="rounded-2xl bg-violet-600 px-3 py-4 text-left text-white shadow-sm"
            onClick={() => navigate('/quests/new')}
          >
            <Plus className="mb-3 h-5 w-5" />
            <div className="text-sm font-semibold">クエスト追加</div>
          </button>
          <button
            type="button"
            className="rounded-2xl border border-slate-200 bg-white px-3 py-4 text-left text-slate-700 shadow-sm"
            onClick={() => navigate('/skills')}
          >
            <Target className="mb-3 h-5 w-5" />
            <div className="text-sm font-semibold">スキルを見る</div>
          </button>
          <button
            type="button"
            className="rounded-2xl border border-slate-200 bg-white px-3 py-4 text-left text-slate-700 shadow-sm"
            onClick={() => navigate('/records')}
          >
            <Trophy className="mb-3 h-5 w-5" />
            <div className="text-sm font-semibold">記録を見る</div>
          </button>
        </div>
      </section>

      <section className="mt-5 pb-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Trophy className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">今日のハイライト</div>
              <div className="mt-1 text-sm text-slate-600">
                {topSkills.length > 0
                  ? `${topSkills[0].name}が一番伸びています。この調子で積み上げていきましょう。`
                  : 'クエストを進めると、今日のハイライトがここに表示されます。'}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </CardContent>
        </Card>
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
