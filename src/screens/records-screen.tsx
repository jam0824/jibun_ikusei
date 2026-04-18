import { History, RotateCcw, Settings2 } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CompletionResolutionCard } from '@/components/completion-resolution-card'
import { RecordsSectionTabs } from '@/components/records-navigation'
import {
  getFilteredActiveCompletions,
  getQuestCompletionRanking,
  getWeeklyReflectionStatus,
  type CompletionHistoryFilter,
} from '@/domain/logic'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent } from '@/components/ui'
import { formatDateTime, isUndoable } from '@/lib/date'
import { useAppStore } from '@/store/app-store'

const recordFilterOptions: Array<{
  key: CompletionHistoryFilter
  label: string
  helper: string
  emptyMessage: string
}> = [
  {
    key: 'today',
    label: '今日',
    helper: '今日のクリア回数',
    emptyMessage: '今日のクリアはまだありません。',
  },
  {
    key: 'week',
    label: '今週',
    helper: '今週のクリア回数',
    emptyMessage: '今週のクリアはまだありません。',
  },
  {
    key: 'all',
    label: 'すべて',
    helper: '累計のクリア回数',
    emptyMessage: 'まだ記録されたクリアはありません。',
  },
]

const subtitles: Record<CompletionHistoryFilter, string> = {
  today: '今日クリアしたクエストを新しい順で確認できます。',
  week: '今週クリアしたクエストをまとめて振り返れます。',
  all: 'これまでのクリア履歴をまとめて確認できます。',
}

function parseRecordFilter(value: string | null): CompletionHistoryFilter {
  if (value === 'week' || value === 'all') {
    return value
  }

  return 'today'
}

export function RecordsScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useAppStore()
  const activeFilter = parseRecordFilter(searchParams.get('range') ?? searchParams.get('filter'))

  const completionCounts = useMemo(
    () => ({
      today: getFilteredActiveCompletions(state.completions, 'today').length,
      week: getFilteredActiveCompletions(state.completions, 'week').length,
      all: getFilteredActiveCompletions(state.completions, 'all').length,
    }),
    [state.completions],
  )

  const filteredCompletions = useMemo(
    () => getFilteredActiveCompletions(state.completions, activeFilter),
    [activeFilter, state.completions],
  )

  const questRanking = useMemo(
    () =>
      activeFilter === 'today'
        ? []
        : getQuestCompletionRanking(state.quests, state.completions, activeFilter),
    [activeFilter, state.completions, state.quests],
  )

  const activeOption =
    recordFilterOptions.find((option) => option.key === activeFilter) ?? recordFilterOptions[0]
  const weeklyReflectionStatus = getWeeklyReflectionStatus(state)

  return (
    <Screen
      title="成長記録"
      subtitle={subtitles[activeFilter]}
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <RecordsSectionTabs active="growth" growthHref={`/records/growth?range=${activeFilter}`} />

      <div className="grid grid-cols-3 gap-3">
        {recordFilterOptions.map((option) => {
          const isActive = option.key === activeFilter
          return (
            <button
              key={option.key}
              type="button"
              aria-label={`${option.label}のクリア回数を表示`}
              aria-pressed={isActive}
              className="text-left transition"
              onClick={() => setSearchParams({ range: option.key })}
            >
              <Card
                className={`h-full ${
                  isActive
                    ? 'border-violet-300 bg-violet-50 shadow-md shadow-violet-100'
                    : 'hover:border-violet-200 hover:bg-violet-50/40'
                }`}
              >
                <CardContent className="p-4">
                  <div className="text-xs text-slate-500">{option.label}</div>
                  <div className="mt-1 text-xl font-black text-slate-900">
                    {completionCounts[option.key]}回
                  </div>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      <section className="mt-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/85 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">{activeOption.helper}</div>
          <Badge>{filteredCompletions.length}回</Badge>
        </div>
      </section>

      {activeFilter === 'week' && weeklyReflectionStatus.available ? (
        <section className="mt-4">
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-900">先週のふりかえり</div>
                  {weeklyReflectionStatus.unread ? <Badge tone="warning">未読</Badge> : null}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  先週の流れを軽く見直して、来週の整え方を決めよう。
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

      {questRanking.length > 0 ? (
        <section className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-slate-900">
                {activeFilter === 'week' ? '今週のクリア回数上位10位' : '累計クリア回数上位10位'}
              </div>
              <div className="mt-3 space-y-3">
                {questRanking.map((entry, index) => (
                  <div
                    key={entry.questId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-black text-violet-700">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {entry.title}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-500">
                      {activeFilter === 'week' ? (
                        <>
                          <div className="text-sm font-semibold text-slate-900">
                            今週 {entry.currentCount}回
                          </div>
                          <div>先週 {entry.previousWeekCount ?? 0}回</div>
                        </>
                      ) : (
                        <div className="text-sm font-semibold text-slate-900">
                          累計 {entry.currentCount}回
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="mt-5 space-y-3 pb-6">
        {filteredCompletions.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-slate-500">
              {activeOption.emptyMessage}
            </CardContent>
          </Card>
        ) : (
          filteredCompletions.map((completion) => {
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
                          <div className="text-sm font-semibold text-slate-900">
                            {quest?.title ?? '削除されたクエスト'}
                          </div>
                          <Badge tone={completion.userXpAwarded < 0 ? 'warning' : 'soft'}>
                            {completion.userXpAwarded >= 0 ? '+' : ''}
                            {completion.userXpAwarded} User XP
                          </Badge>
                          {completion.skillXpAwarded ? (
                            <Badge>+{completion.skillXpAwarded} Skill XP</Badge>
                          ) : null}
                          {quest?.source === 'browsing' && quest.browsingType === 'good' ? (
                            <Badge tone="browsing">閲覧</Badge>
                          ) : null}
                          {quest?.source === 'browsing' && quest.browsingType === 'bad' ? (
                            <Badge tone="warning">バッド閲覧</Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(completion.completedAt)}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Badge tone="outline">{skill?.name ?? '未分類'}</Badge>
                          {quest?.source === 'browsing' && quest.domain ? (
                            <Badge tone="outline">{quest.domain}</Badge>
                          ) : null}
                          {quest?.source === 'browsing' && quest.browsingCategory ? (
                            <Badge tone="outline">{quest.browsingCategory}</Badge>
                          ) : null}
                          {message ? (
                            <Badge tone="success">Lilyコメントあり</Badge>
                          ) : (
                            <Badge tone="outline">コメントなし</Badge>
                          )}
                        </div>
                        {completion.note ? (
                          <div className="mt-3 text-sm text-slate-600">{completion.note}</div>
                        ) : null}
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
                          取り消す
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                <CompletionResolutionCard
                  completion={completion}
                  candidates={candidates}
                  onSelect={(skillId) =>
                    useAppStore.getState().confirmCompletionSkill(completion.id, skillId)
                  }
                />
              </div>
            )
          })
        )}
      </section>

      <section className="mt-auto">
        <Card className="border-violet-100 bg-violet-50">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <History className="h-5 w-5" />
            </div>
            <div className="text-sm leading-6 text-violet-900">
              クリアから10分以内の記録は取り消せます。必要に応じてスキル候補の確認もこの画面から行えます。
            </div>
          </CardContent>
        </Card>
      </section>
    </Screen>
  )
}
