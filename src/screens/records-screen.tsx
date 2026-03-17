import { useMemo } from 'react'
import { History, RotateCcw, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CompletionResolutionCard } from '@/components/completion-resolution-card'
import { getTodayActiveCompletions } from '@/domain/logic'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent } from '@/components/ui'
import { formatDateTime, isUndoable } from '@/lib/date'
import { useAppStore } from '@/store/app-store'

export function RecordsScreen() {
  const navigate = useNavigate()
  const state = useAppStore()
  const activeCompletions = useMemo(
    () => state.completions.filter((completion) => !completion.undoneAt),
    [state.completions],
  )
  const todayCompletions = useMemo(
    () => getTodayActiveCompletions(state.completions),
    [state.completions],
  )
  const todayXp = todayCompletions.reduce((sum, completion) => sum + completion.userXpAwarded, 0)

  return (
    <Screen
      title="記録"
      subtitle="完了ログを振り返って、あとから取り消しもできます"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">今日の件数</div>
            <div className="mt-1 text-xl font-black text-slate-900">{todayCompletions.length}件</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">今日のXP</div>
            <div className="mt-1 text-xl font-black text-slate-900">+{todayXp}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">累計ログ</div>
            <div className="mt-1 text-xl font-black text-slate-900">{activeCompletions.length}件</div>
          </CardContent>
        </Card>
      </div>

      <section className="mt-5 space-y-3 pb-6">
        {activeCompletions.map((completion) => {
          const quest = state.quests.find((entry) => entry.id === completion.questId)
          const skill = completion.resolvedSkillId
            ? state.skills.find((entry) => entry.id === completion.resolvedSkillId)
            : undefined
          const message = completion.assistantMessageId
            ? state.assistantMessages.find((entry) => entry.id === completion.assistantMessageId)
            : undefined
          const candidates = (completion.candidateSkillIds ?? [])
            .map((skillId) => state.skills.find((skillEntry) => skillEntry.id === skillId))
            .filter((value): value is NonNullable<typeof value> => Boolean(value))

          return (
            <div key={completion.id} className="space-y-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{quest?.title ?? '名前のないクエスト'}</div>
                        <Badge tone="soft">+{completion.userXpAwarded} User XP</Badge>
                        {completion.skillXpAwarded ? <Badge>+{completion.skillXpAwarded} Skill XP</Badge> : null}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(completion.completedAt)}</div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge tone="outline">{skill?.name ?? '未分類'}</Badge>
                        {message ? <Badge tone="success">リリィコメントあり</Badge> : <Badge tone="outline">コメントなし</Badge>}
                      </div>
                      {completion.note ? <div className="mt-3 text-sm text-slate-600">{completion.note}</div> : null}
                    </div>
                    {isUndoable(completion.completedAt, completion.undoneAt) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          useAppStore.getState().undoCompletion(completion.id)
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                        取り消し
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <CompletionResolutionCard
                completion={completion}
                candidates={candidates}
                onSelect={(skillId) => useAppStore.getState().confirmCompletionSkill(completion.id, skillId)}
              />
            </div>
          )
        })}
      </section>

      <section className="mt-auto">
        <Card className="border-violet-100 bg-violet-50">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <History className="h-5 w-5" />
            </div>
            <div className="text-sm leading-6 text-violet-900">
              10分以内なら完了の取り消しができます。判定待ちのスキル候補もここで確認できます。
            </div>
          </CardContent>
        </Card>
      </section>
    </Screen>
  )
}
