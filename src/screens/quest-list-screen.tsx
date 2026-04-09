import { useMemo, useState } from 'react'
import { Filter, Search, Settings2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { getQuestAvailability, getQuestIdsWithActiveCompletions, isDailyQuest } from '@/domain/logic'
import { QuestCompleteModal } from '@/components/quest-complete-modal'
import { QuestCard } from '@/components/quest-card'
import { Screen } from '@/components/layout'
import { Button, Card, CardContent, Input } from '@/components/ui'
import { useAppStore } from '@/store/app-store'

const tabs = [
  { key: 'daily', label: 'デイリー' },
  { key: 'repeatable', label: '繰り返し' },
  { key: 'one_time', label: '単発' },
  { key: 'all', label: 'すべて' },
  { key: 'completed', label: '完了済み' },
  { key: 'archived', label: 'アーカイブ' },
] as const

export function QuestListScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<(typeof tabs)[number]['key']>('daily')
  const [query, setQuery] = useState('')
  const { quests, completions, skills, completeQuest, reopenQuest } = useAppStore(
    useShallow((state) => ({
      quests: state.quests,
      completions: state.completions,
      skills: state.skills,
      completeQuest: state.completeQuest,
      reopenQuest: state.reopenQuest,
    })),
  )

  const activeQuestId = searchParams.get('complete')
  const activeQuest = activeQuestId ? quests.find((quest) => quest.id === activeQuestId) : undefined

  const filtered = useMemo(() => {
    const activeCompletions = completions.filter((completion) => !completion.undoneAt)
    const completionQuestIds = getQuestIdsWithActiveCompletions(completions)
    const latestCompletionAtByQuestId = new Map<string, number>()

    for (const completion of activeCompletions) {
      const completedAt = new Date(completion.completedAt).getTime()
      const currentLatest = latestCompletionAtByQuestId.get(completion.questId) ?? 0
      if (completedAt > currentLatest) {
        latestCompletionAtByQuestId.set(completion.questId, completedAt)
      }
    }

    return quests
      .filter((quest) => tab === 'archived' ? quest.status === 'archived' : quest.status !== 'archived')
      .filter((quest) => {
        if (tab === 'archived') return true
        if (tab === 'daily') {
          return isDailyQuest(quest) && quest.source !== 'browsing'
        }
        if (tab === 'repeatable') {
          return quest.questType === 'repeatable' && !isDailyQuest(quest) && quest.source !== 'browsing'
        }
        if (tab === 'one_time') {
          return quest.questType === 'one_time' && quest.status !== 'completed' && quest.source !== 'browsing'
        }
        if (tab === 'completed') {
          return completionQuestIds.has(quest.id)
        }
        // "すべて" tab: show browsing quests too (except completed one_time quests)
        return !(quest.questType === 'one_time' && quest.status === 'completed')
      })
      .filter((quest) => {
        const haystack = `${quest.title} ${quest.description ?? ''}`.toLowerCase()
        return haystack.includes(query.toLowerCase())
      })
      .sort((left, right) => {
        if (tab === 'completed') {
          const leftLatest = latestCompletionAtByQuestId.get(left.id) ?? 0
          const rightLatest = latestCompletionAtByQuestId.get(right.id) ?? 0
          if (leftLatest !== rightLatest) {
            return rightLatest - leftLatest
          }
        }

        const leftAvailability = getQuestAvailability(left, completions)
        const rightAvailability = getQuestAvailability(right, completions)
        const leftScore = (left.pinned ? 100 : 0) + (leftAvailability.canComplete ? 20 : 0) + left.xpReward
        const rightScore = (right.pinned ? 100 : 0) + (rightAvailability.canComplete ? 20 : 0) + right.xpReward
        return rightScore - leftScore
      })
  }, [completions, query, quests, tab])

  return (
    <Screen
      title="クエスト"
      subtitle="今日やることと進行中のタスクをまとめて確認できます"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">デイリー</div>
            <div className="mt-1 text-xl font-black text-slate-900">
              {quests.filter((quest) => quest.status !== 'archived' && isDailyQuest(quest) && quest.source !== 'browsing').length}件
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">期限切れ</div>
            <div className="mt-1 text-xl font-black text-slate-900">
              {quests.filter((quest) => getQuestAvailability(quest, completions).state === 'expired').length}件
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">繰り返し</div>
            <div className="mt-1 text-xl font-black text-slate-900">
              {quests.filter((quest) => quest.status !== 'archived' && quest.questType === 'repeatable' && !isDailyQuest(quest) && quest.source !== 'browsing').length}件
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="mt-5">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="クエストを検索"
              className="bg-white pl-10"
            />
          </div>
          <Button variant="outline" size="icon" aria-label="並び順">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="mt-4">
        <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition ${
                tab === item.key
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div>{tab === 'completed' ? '表示順: 最新クリア順' : '表示順: ピン・状態・XP'}</div>
          <button type="button" className="rounded-xl px-2 py-1 text-violet-700 hover:bg-violet-50">
            並び替え
          </button>
        </div>
      </section>

      <section className="mt-4 space-y-3 pb-6">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-slate-500">
              条件に合うクエストがありません。
            </CardContent>
          </Card>
        ) : (
          filtered.map((quest) => {
            const availability = getQuestAvailability(quest, completions)
            const skill = skills.find((entry) => entry.id === (quest.fixedSkillId ?? quest.defaultSkillId))
            const actionLabel =
              tab === 'archived'
                ? '再オープン'
                : tab === 'completed'
                  ? quest.status === 'completed'
                    ? '再オープン'
                    : '詳細'
                  : quest.status === 'completed'
                    ? '再オープン'
                    : availability.canComplete
                      ? 'クリア'
                      : '詳細'

            return (
              <QuestCard
                key={quest.id}
                quest={quest}
                availability={availability}
                skill={skill}
                actionLabel={actionLabel}
                onAction={() => {
                  if (tab === 'archived') {
                    reopenQuest(quest.id)
                    return
                  }
                  if (quest.status === 'completed') {
                    reopenQuest(quest.id)
                    return
                  }
                  if (tab === 'completed') {
                    navigate(`/quests/new?edit=${quest.id}`)
                    return
                  }
                  if (availability.canComplete) {
                    const next = new URLSearchParams(searchParams)
                    next.set('complete', quest.id)
                    setSearchParams(next)
                    return
                  }
                  navigate(`/quests/new?edit=${quest.id}`)
                }}
                onOpen={() => navigate(`/quests/new?edit=${quest.id}`)}
              />
            )
          })
        )}
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
              sourceScreen: 'quest_list',
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
