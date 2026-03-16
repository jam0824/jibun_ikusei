import { ArrowRightLeft, Flame, Link2, Sparkles, X } from 'lucide-react'
import type { PersistedAppState, Skill } from '@/domain/types'
import {
  getRelatedSkills,
  getSevenDaySkillGain,
  getSkillLinkedQuests,
  getSkillRecentCompletions,
} from '@/domain/logic'
import { formatDateTime } from '@/lib/date'
import { Badge, Button, Card, CardContent, Progress } from '@/components/ui'

export function SkillDetailSheet({
  skill,
  state,
  onClose,
  onMerge,
}: {
  skill: Skill
  state: PersistedAppState
  onClose: () => void
  onMerge: (targetSkillId: string) => void
}) {
  const linkedQuests = getSkillLinkedQuests(state, skill.id)
  const recentCompletions = getSkillRecentCompletions(state, skill.id).slice(0, 4)
  const relatedSkills = getRelatedSkills(state, skill).slice(0, 3)
  const weekGain = getSevenDaySkillGain(state, skill.id)

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]">
      <Card className="w-full max-w-2xl overflow-hidden rounded-[2rem] border-0 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Skill Detail</div>
              <div className="mt-1 text-xl font-black text-slate-900">{skill.name}</div>
              <div className="mt-1 text-sm text-slate-500">{skill.category}</div>
            </div>
            <Button variant="ghost" size="icon" className="rounded-2xl text-slate-500" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardContent className="space-y-5 p-5">
          <Card className="border-violet-100 bg-violet-50">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-violet-950">Lv.{skill.level}</div>
                  <div className="text-sm text-violet-700">Total {skill.totalXp}XP</div>
                </div>
                <Badge>{weekGain >= 0 ? `直近7日 +${weekGain}XP` : '直近7日 0XP'}</Badge>
              </div>
              <Progress value={(skill.totalXp % 50) * 2} />
            </CardContent>
          </Card>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Link2 className="h-4 w-4 text-slate-500" />
              関連クエスト
            </div>
            <div className="space-y-2">
              {linkedQuests.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  関連するクエストはまだありません。
                </div>
              ) : (
                linkedQuests.map((quest) => (
                  <div key={quest.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="font-semibold text-slate-900">{quest.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{quest.description || '説明はまだありません'}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Flame className="h-4 w-4 text-slate-500" />
              最近の成長ログ
            </div>
            <div className="space-y-2">
              {recentCompletions.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  まだ成長ログがありません。
                </div>
              ) : (
                recentCompletions.map((completion) => (
                  <div key={completion.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="font-medium text-slate-900">{formatDateTime(completion.completedAt)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      +{completion.skillXpAwarded ?? 0}XP {completion.note ? ` / ${completion.note}` : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-slate-500" />
              関連スキル候補
            </div>
            <div className="space-y-2">
              {relatedSkills.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  同じカテゴリの関連スキルはまだありません。
                </div>
              ) : (
                relatedSkills.map((related) => (
                  <div
                    key={related.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{related.name}</div>
                      <div className="text-xs text-slate-500">
                        Lv.{related.level} / {related.totalXp}XP
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => onMerge(related.id)}>
                      <ArrowRightLeft className="h-4 w-4" />
                      統合
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
