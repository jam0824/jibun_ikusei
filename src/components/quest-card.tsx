import { Clock3, Pin } from 'lucide-react'
import type { Quest, QuestAvailability, Skill } from '@/domain/types'
import { getQuestStatusTone } from '@/domain/logic'
import { Badge, Button, Card, CardContent } from '@/components/ui'

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
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Clock3 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="truncate text-left text-sm font-semibold text-slate-900 hover:text-violet-700"
                onClick={onOpen}
              >
                {quest.title}
              </button>
              <Badge tone="soft">+{quest.xpReward}XP</Badge>
              {quest.pinned ? (
                <Badge tone="success">
                  <Pin className="h-3 w-3" />
                  優先
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-slate-500">{quest.description || '説明なし'}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {skill ? <Badge>{skill.name}</Badge> : <Badge tone="outline">未設定</Badge>}
              <Badge tone="outline">{quest.questType === 'repeatable' ? '定常' : '単発'}</Badge>
              <span className={`inline-flex items-center gap-1 text-[11px] ${getQuestStatusTone(availability)}`}>
                <Clock3 className="h-3 w-3" />
                {availability.label}
              </span>
            </div>
          </div>
          <Button
            variant={actionLabel === '詳細' ? 'outline' : actionLabel === '再オープン' ? 'secondary' : 'primary'}
            className="px-4"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
