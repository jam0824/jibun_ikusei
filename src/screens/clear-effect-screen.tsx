import { useEffect, useEffectEvent } from 'react'
import { ArrowRight, Play, ScrollText, Sparkles, Star, Trophy } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { CompletionResolutionCard } from '@/components/completion-resolution-card'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Progress } from '@/components/ui'
import { useAppStore } from '@/store/app-store'

export function ClearEffectScreen() {
  const navigate = useNavigate()
  const { completionId } = useParams<{ completionId: string }>()
  const state = useAppStore()
  const completion = state.completions.find((entry) => entry.id === completionId)
  const quest = completion ? state.quests.find((entry) => entry.id === completion.questId) : undefined
  const skill = completion?.resolvedSkillId ? state.skills.find((entry) => entry.id === completion.resolvedSkillId) : undefined
  const message = completion?.assistantMessageId
    ? state.assistantMessages.find((entry) => entry.id === completion.assistantMessageId)
    : state.assistantMessages[0]
  const candidateSkills = (completion?.candidateSkillIds ?? [])
    .map((skillId) => state.skills.find((skillEntry) => skillEntry.id === skillId))
    .filter((value): value is NonNullable<typeof value> => Boolean(value))

  const playCurrentMessage = useEffectEvent(() => {
    if (message && state.settings.lilyAutoPlay === 'on') {
      void state.playAssistantMessage(message.id)
    }
  })

  useEffect(() => {
    playCurrentMessage()
  }, [message?.id])

  if (!completion || !quest) {
    return (
      <Screen title="クリア演出" subtitle="直近のクエスト結果を表示します" withBottomNav={false}>
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            表示できるクリア演出が見つかりませんでした。
          </CardContent>
        </Card>
      </Screen>
    )
  }

  return (
    <Screen title="クリア演出" subtitle="成長結果をまとめて確認します" withBottomNav={false}>
      <Card className="overflow-hidden border-0 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
        <div className="bg-gradient-to-b from-violet-50 to-white px-5 pb-4 pt-6">
          <div className="flex flex-col items-center text-center">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-violet-600 text-white shadow-[0_16px_40px_rgba(139,92,246,0.35)]">
              <Trophy className="h-10 w-10" />
              <div className="absolute inset-0 rounded-full ring-8 ring-violet-200/60" />
            </div>

            <div className="mt-5">
              <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                <Sparkles className="h-3.5 w-3.5" />
                Quest Clear
              </div>
              <div className="mt-3 text-2xl font-black tracking-tight text-slate-900">{quest.title}</div>
              <div className="mt-1 text-sm text-slate-500">{quest.description || '説明なし'}</div>
            </div>
          </div>
        </div>

        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl border border-violet-100 bg-violet-50 p-4 text-center">
              <div className="text-xs font-medium text-violet-700">獲得XP</div>
              <div className="mt-2 text-3xl font-black tracking-tight text-violet-900">+{completion.userXpAwarded}</div>
              <div className="mt-1 text-xs text-violet-600">User XP</div>
            </div>
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-center">
              <div className="text-xs font-medium text-emerald-700">スキル</div>
              <div className="mt-2 text-lg font-black tracking-tight text-emerald-900">{skill?.name ?? '判定中'}</div>
              <div className="mt-1 text-xs text-emerald-600">
                {completion.skillXpAwarded ? `+${completion.skillXpAwarded} Skill XP` : 'スキル解決を継続中'}
              </div>
            </div>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Trophy className="h-4 w-4 text-amber-500" />
                ユーザー進捗
              </div>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <div className="text-2xl font-black tracking-tight text-slate-900">Lv.{state.user.level}</div>
                  <div className="mt-1 text-sm text-slate-500">次のレベルまであと {100 - (state.user.totalXp % 100 || 0)}XP</div>
                </div>
                <Badge>{state.user.totalXp} XP</Badge>
              </div>
              <Progress value={((state.user.totalXp % 100) / 100) * 100} />
            </CardContent>
          </Card>

          {skill ? (
            <Card>
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Star className="h-4 w-4 text-fuchsia-500" />
                  スキル進捗
                </div>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-lg font-black tracking-tight text-slate-900">
                      {skill.name} Lv.{skill.level}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">次のレベルまであと {50 - (skill.totalXp % 50 || 0)}XP</div>
                  </div>
                  <Badge>{skill.totalXp} XP</Badge>
                </div>
                <Progress value={((skill.totalXp % 50) / 50) * 100} />
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-violet-100 bg-violet-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                  <Star className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold text-violet-900">リリィ</div>
                    <Badge tone="outline">コメント</Badge>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-violet-700">
                    {message?.text ?? 'ナイスです。今日の成長がしっかり記録されました。'}
                  </div>
                </div>
                {message ? (
                  <Button size="icon" variant="outline" className="rounded-2xl bg-white" onClick={() => void state.playAssistantMessage(message.id)}>
                    <Play className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <CompletionResolutionCard
            completion={completion}
            candidates={candidateSkills}
            onSelect={(skillId) => state.confirmCompletionSkill(completion.id, skillId)}
          />

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button variant="outline" className="h-12" onClick={() => navigate('/records')}>
              <ScrollText className="h-4 w-4" />
              記録を見る
            </Button>
            <Button className="h-12" onClick={() => navigate('/')}>
              次のクエスト
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </Screen>
  )
}
