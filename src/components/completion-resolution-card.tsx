import { Brain, HelpCircle } from 'lucide-react'
import type { QuestCompletion, Skill } from '@/domain/types'
import { Badge, Button, Card, CardContent } from '@/components/ui'

export function CompletionResolutionCard({
  completion,
  candidates,
  onSelect,
}: {
  completion: QuestCompletion
  candidates: Skill[]
  onSelect: (skillId: string) => void
}) {
  if (completion.skillResolutionStatus !== 'needs_confirmation' || candidates.length === 0) {
    return null
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <Brain className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-amber-950">スキル候補を確認</div>
              <Badge tone="outline">AI中信頼</Badge>
            </div>
            <div className="mt-1 text-sm leading-6 text-amber-800">
              {completion.resolutionReason || 'どのスキルに紐づくか確認すると、次回以降の精度が上がります。'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {candidates.map((skill) => (
                <Button key={skill.id} size="sm" variant="outline" onClick={() => onSelect(skill.id)}>
                  {skill.name}
                </Button>
              ))}
            </div>
          </div>
          <HelpCircle className="h-4 w-4 text-amber-500" />
        </div>
      </CardContent>
    </Card>
  )
}
