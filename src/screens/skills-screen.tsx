import { useMemo, useState } from 'react'
import { Merge, Settings2, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Skill } from '@/domain/types'
import { getSevenDaySkillGain } from '@/domain/logic'
import { SkillDetailSheet } from '@/components/skill-detail-sheet'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Progress } from '@/components/ui'
import { useAppStore } from '@/store/app-store'

export function SkillsScreen() {
  const navigate = useNavigate()
  const [activeSkill, setActiveSkill] = useState<Skill>()
  const [mergeError, setMergeError] = useState<string>()
  const state = useAppStore()

  const activeSkills = useMemo(
    () => state.skills.filter((skill) => skill.status === 'active'),
    [state.skills],
  )

  return (
    <Screen
      title="スキル"
      subtitle="どの成長が伸びているかを一覧で確認できます"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <section className="grid grid-cols-2 gap-3">
        {activeSkills.length === 0 ? (
          <Card className="col-span-2">
            <CardContent className="p-6 text-center text-sm text-slate-500">
              まだスキルが育っていません。クエストをクリアするとここに表示されます。
            </CardContent>
          </Card>
        ) : (
          activeSkills.map((skill) => {
            const progress = (skill.totalXp % 50) * 2
            const weekGain = getSevenDaySkillGain(state, skill.id)
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => setActiveSkill(skill)}
                className="text-left"
              >
                <Card className="h-full">
                  <CardContent className="p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{skill.name}</div>
                        <div className="text-xs text-slate-500">{skill.category}</div>
                      </div>
                      <Badge>Lv.{skill.level}</Badge>
                    </div>
                    <Progress value={progress} />
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>{skill.totalXp}XP</span>
                      <span>直近7日 +{weekGain}XP</span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            )
          })
        )}
      </section>

      {mergeError ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mergeError}
        </div>
      ) : null}

      <section className="mt-5">
        <Card className="border-violet-100 bg-violet-50">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-violet-950">スキル統合</div>
              <div className="mt-1 text-sm text-violet-800">
                似たスキルが増えてきたら統合できます。完了ログや辞書の参照先もまとめて引き継ぎます。
              </div>
            </div>
            <Merge className="h-5 w-5 text-violet-600" />
          </CardContent>
        </Card>
      </section>

      {activeSkill ? (
        <SkillDetailSheet
          skill={activeSkill}
          state={state}
          onClose={() => setActiveSkill(undefined)}
          onMerge={(targetSkillId) => {
            const result = useAppStore.getState().mergeSkills(activeSkill.id, targetSkillId)
            if (!result.ok) {
              setMergeError(result.reason)
              return
            }
            setMergeError(undefined)
            setActiveSkill(undefined)
          }}
        />
      ) : null}
    </Screen>
  )
}
