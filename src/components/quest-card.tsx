import { Clock3, Globe, Pin } from 'lucide-react'
import type { Quest, QuestAvailability, Skill } from '@/domain/types'
import { getQuestStatusTone, getQuestTypeLabel } from '@/domain/logic'
import { Badge, Button, Card, CardContent } from '@/components/ui'

function getXpLabel(xp: number): string {
  return `${xp >= 0 ? '+' : ''}${xp}XP`
}

function getBrowsingCardClass(quest: Quest): string {
  if (quest.browsingType === 'good') return 'border-teal-200 bg-teal-50/40'
  if (quest.browsingType === 'bad') return 'border-orange-200 bg-orange-50/40'
  return ''
}

export function QuestCard({
  quest,
  availability,
  skill,
  actionLabel,
  onAction,
  onOpen,
}: {
  quest: Quest
  availability: QuestAvailability
  skill?: Skill
  actionLabel: string
  onAction: () => void
  onOpen?: () => void
}) {
  const isBrowsing = quest.source === 'browsing'

  return (
    <Card
      className={`overflow-hidden ${getBrowsingCardClass(quest)} ${onOpen ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onOpen}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Clock3 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-left text-sm font-semibold text-slate-900">
                {quest.title}
              </span>
              <Badge tone={quest.browsingType === 'bad' ? 'warning' : 'soft'}>
                {getXpLabel(quest.xpReward)}
              </Badge>
              {isBrowsing && quest.browsingType === 'good' ? (
                <Badge tone="browsing">閲覧</Badge>
              ) : null}
              {isBrowsing && quest.browsingType === 'bad' ? (
                <Badge tone="warning">バッド閲覧</Badge>
              ) : null}
              {quest.pinned ? (
                <Badge tone="success">
                  <Pin className="h-3 w-3" />
                  ピン留め
                </Badge>
              ) : null}
            </div>
            {isBrowsing && quest.domain ? (
              <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                <Globe className="h-3 w-3" />
                {quest.domain}
              </div>
            ) : null}
            <div className="mt-1 text-xs text-slate-500">{quest.description || '説明はまだありません'}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {skill ? <Badge>{skill.name}</Badge> : <Badge tone="outline">未設定</Badge>}
              <Badge tone="outline">{getQuestTypeLabel(quest)}</Badge>
              {isBrowsing && quest.browsingCategory ? (
                <Badge tone="outline">{quest.browsingCategory}</Badge>
              ) : null}
              <span className={`inline-flex items-center gap-1 text-[11px] ${getQuestStatusTone(availability)}`}>
                <Clock3 className="h-3 w-3" />
                {availability.label}
              </span>
            </div>
          </div>
          <Button
            variant={actionLabel === '詳細' ? 'outline' : actionLabel === '再オープン' ? 'secondary' : 'primary'}
            className="px-4"
            onClick={(e) => { e.stopPropagation(); onAction() }}
          >
            {actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
