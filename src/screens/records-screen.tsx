import { useMemo, useRef, useState } from 'react'
import { CalendarDays, Globe, History, RotateCcw, ScrollText, Settings2, Utensils } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CompletionResolutionCard } from '@/components/completion-resolution-card'
import {
  getFilteredActiveCompletions,
  type CompletionHistoryFilter,
} from '@/domain/logic'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent } from '@/components/ui'
import { formatDateTime, isUndoable } from '@/lib/date'
import { useAppStore } from '@/store/app-store'
import { BrowsingTimeView } from '@/screens/browsing-time-view'

type RecordsTab = 'quests' | 'browsing' | 'nutrition'

type NutrientLabel = '不足' | '適正' | '過剰'

interface MockNutrient {
  name: string
  value: number
  unit: string
  label: NutrientLabel
  referenceMax: number
}

const MOCK_NUTRIENTS: MockNutrient[] = [
  { name: 'エネルギー', value: 1822,  unit: 'kcal', label: '不足', referenceMax: 2239 },
  { name: 'たんぱく質', value: 83.3,  unit: 'g',    label: '適正', referenceMax: 178.4 },
  { name: '脂質',       value: 68.2,  unit: 'g',    label: '適正', referenceMax: 79.3 },
  { name: '糖質',       value: 224.4, unit: 'g',    label: '適正', referenceMax: 254.9 },
  { name: 'カリウム',   value: 1704,  unit: 'mg',   label: '不足', referenceMax: 3000 },
  { name: 'カルシウム', value: 472,   unit: 'mg',   label: '不足', referenceMax: 2500 },
  { name: '鉄',         value: 13.7,  unit: 'mg',   label: '適正', referenceMax: 20 },
  { name: 'ビタミンA',  value: 2977,  unit: 'µg',   label: '過剰', referenceMax: 2700 },
  { name: 'ビタミンE',  value: 17,    unit: 'mg',   label: '適正', referenceMax: 800 },
  { name: 'ビタミンB1', value: 3.5,   unit: 'mg',   label: '適正', referenceMax: 5 },
  { name: 'ビタミンB2', value: 3.59,  unit: 'mg',   label: '適正', referenceMax: 5 },
  { name: 'ビタミンB6', value: 4.47,  unit: 'mg',   label: '適正', referenceMax: 60 },
  { name: 'ビタミンC',  value: 136,   unit: 'mg',   label: '適正', referenceMax: 500 },
  { name: '食物繊維',   value: 14.5,  unit: 'g',    label: '不足', referenceMax: 22 },
  { name: '飽和脂肪酸', value: 17.77, unit: 'g',    label: '過剰', referenceMax: 15.86 },
  { name: '塩分',       value: 7.1,   unit: 'g',    label: '適正', referenceMax: 7.5 },
]

const BAR_COLORS: Record<NutrientLabel, string> = {
  '不足': 'bg-blue-400',
  '適正': 'bg-green-400',
  '過剰': 'bg-red-400',
}

function getTodayJst(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDateJst(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

function NutritionMockView() {
  const [date, setDate] = useState(getTodayJst())
  const dateInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-3 pb-6">
      {/* 日付ピッカー */}
      <button
        type="button"
        onClick={() => dateInputRef.current?.showPicker()}
        className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-violet-200 hover:bg-violet-50/40"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CalendarDays className="h-4 w-4 text-violet-500" />
          {formatDateJst(date)}
        </div>
        <span className="text-xs text-slate-400">タップで変更</span>
      </button>
      <input
        ref={dateInputRef}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="absolute opacity-0 pointer-events-none h-0 w-0"
      />

      {/* モックバナー */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
        モックデータを表示しています（1日分）
      </div>

      {/* 栄養素グラフ */}
      {MOCK_NUTRIENTS.map((nutrient) => {
        const pct = Math.min((nutrient.value / nutrient.referenceMax) * 100, 100)
        return (
          <div key={nutrient.name} className="flex items-center gap-2">
            <div className="w-20 shrink-0 text-xs text-slate-600">{nutrient.name}</div>
            <div className="flex-1 overflow-hidden rounded-full bg-slate-100" style={{ height: '8px' }}>
              <div
                className={`h-full rounded-full ${BAR_COLORS[nutrient.label]}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-20 shrink-0 text-right text-xs text-slate-500">
              {nutrient.value} {nutrient.unit}
            </div>
          </div>
        )
      })}

      {/* 凡例 */}
      <div className="flex items-center gap-4 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-full bg-blue-400" />不足</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-full bg-green-400" />適正</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-full bg-red-400" />過剰</span>
      </div>
    </div>
  )
}

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

function parseRecordFilter(value: string | null): CompletionHistoryFilter {
  if (value === 'week' || value === 'all') {
    return value
  }

  return 'today'
}

const subtitles: Record<RecordsTab, Record<string, string>> = {
  quests: {
    today: '今日クリアしたクエストを新しい順で確認できます。',
    week: '今週クリアしたクエストをまとめて振り返れます。',
    all: 'これまでのクリア履歴をまとめて確認できます。',
  },
  browsing: {
    default: 'ドメインごとの閲覧時間を確認できます。',
  },
  nutrition: {
    default: '本日の栄養素摂取状況を確認できます。',
  },
}

export function RecordsScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useAppStore()
  const [activeTab, setActiveTab] = useState<RecordsTab>('quests')
  const activeFilter = parseRecordFilter(searchParams.get('filter'))

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

  const activeOption = recordFilterOptions.find((option) => option.key === activeFilter) ?? recordFilterOptions[0]

  const subtitle =
    activeTab === 'quests'
      ? subtitles.quests[activeFilter]
      : activeTab === 'browsing'
        ? subtitles.browsing.default
        : subtitles.nutrition.default

  return (
    <Screen
      title="記録"
      subtitle={subtitle}
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('quests')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            activeTab === 'quests'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <ScrollText className="h-3.5 w-3.5" />
          クエスト
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('browsing')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            activeTab === 'browsing'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          閲覧時間
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('nutrition')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            activeTab === 'nutrition'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Utensils className="h-3.5 w-3.5" />
          栄養
        </button>
      </div>

      {activeTab === 'browsing' ? (
        <BrowsingTimeView />
      ) : activeTab === 'nutrition' ? (
        <NutritionMockView />
      ) : (
        <>
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
                  onClick={() => setSearchParams({ filter: option.key })}
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
                                {completion.userXpAwarded >= 0 ? '+' : ''}{completion.userXpAwarded} User XP
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
        </>
      )}
    </Screen>
  )
}
