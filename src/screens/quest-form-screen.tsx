import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { ChevronRight, Lock, Settings2, Sparkles, Target } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { buildQuestDraft } from '@/domain/logic'
import type { Quest, SkillMappingMode } from '@/domain/types'
import {
  MAX_REPEATABLE_COOLDOWN,
  MAX_REPEATABLE_DAILY_CAP,
  MIN_REPEATABLE_COOLDOWN,
  MIN_REPEATABLE_DAILY_CAP,
  QUEST_CATEGORIES,
} from '@/domain/constants'
import { toDateTimeLocalValue } from '@/lib/date'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Input, Select, Switch, Textarea } from '@/components/ui'
import { useAppStore } from '@/store/app-store'

const questSchema = z.object({
  title: z.string().min(1, 'タイトルを入力してください。').max(60, 'タイトルは60文字以内で入力してください。'),
  description: z.string().max(240, '説明は240文字以内で入力してください。'),
  xpReward: z.number().min(1).max(100),
})

const xpPresets = [3, 5, 10, 20, 40]

export function QuestFormScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const { quests, completions, skills, settings, upsertQuest, deleteQuest, archiveQuest } = useAppStore(
    useShallow((state) => ({
      quests: state.quests,
      completions: state.completions,
      skills: state.skills,
      settings: state.settings,
      upsertQuest: state.upsertQuest,
      deleteQuest: state.deleteQuest,
      archiveQuest: state.archiveQuest,
    })),
  )

  const editingQuest = useMemo(() => quests.find((quest) => quest.id === editId), [editId, quests])
  const draft = useMemo(() => buildQuestDraft(editingQuest), [editingQuest])
  const skillOptions = skills.filter((skill) => skill.status === 'active')
  const hasActiveCompletion = useMemo(
    () => Boolean(editingQuest && completions.some((completion) => completion.questId === editingQuest.id && !completion.undoneAt)),
    [completions, editingQuest],
  )

  const [form, setForm] = useState<Quest>(draft)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setForm(draft)
  }, [draft])

  const update = <K extends keyof Quest>(key: K, value: Quest[K]) => {
    setError(undefined)
    setForm((current) => {
      const next = { ...current, [key]: value, updatedAt: new Date().toISOString() }
      if (key === 'privacyMode' && value === 'no_ai' && next.skillMappingMode !== 'fixed') {
        next.skillMappingMode = 'fixed'
      }
      return next
    })
  }

  const save = () => {
    setError(undefined)
    const parsed = questSchema.safeParse({
      title: form.title,
      description: form.description ?? '',
      xpReward: form.xpReward,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }

    if (form.skillMappingMode === 'fixed' && !form.fixedSkillId) {
      setError('固定スキルを選択してください。')
      return
    }

    if (form.questType === 'repeatable') {
      if (
        !Number.isInteger(form.cooldownMinutes ?? Number.NaN) ||
        (form.cooldownMinutes ?? 0) < MIN_REPEATABLE_COOLDOWN ||
        (form.cooldownMinutes ?? 0) > MAX_REPEATABLE_COOLDOWN
      ) {
        setError(`クールダウンは${MIN_REPEATABLE_COOLDOWN}〜${MAX_REPEATABLE_COOLDOWN}分の整数で入力してください。`)
        return
      }

      if (
        !Number.isInteger(form.dailyCompletionCap ?? Number.NaN) ||
        (form.dailyCompletionCap ?? 0) < MIN_REPEATABLE_DAILY_CAP ||
        (form.dailyCompletionCap ?? 0) > MAX_REPEATABLE_DAILY_CAP
      ) {
        setError(`1日上限は${MIN_REPEATABLE_DAILY_CAP}〜${MAX_REPEATABLE_DAILY_CAP}回の整数で入力してください。`)
        return
      }
    }

    const normalizedQuest: Quest =
      form.questType === 'one_time'
        ? {
            ...form,
            cooldownMinutes: undefined,
            dailyCompletionCap: undefined,
          }
        : {
            ...form,
            cooldownMinutes: Math.trunc(form.cooldownMinutes ?? MIN_REPEATABLE_COOLDOWN),
            dailyCompletionCap: Math.trunc(form.dailyCompletionCap ?? MIN_REPEATABLE_DAILY_CAP),
          }

    upsertQuest(normalizedQuest)
    navigate('/quests')
  }

  const handleDelete = () => {
    if (!editingQuest) {
      return
    }

    setError(undefined)
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(`「${editingQuest.title || 'このクエスト'}」を削除します。\nこの操作は元に戻せません。`)

    if (!confirmed) {
      return
    }

    const result = deleteQuest(editingQuest.id)
    if (!result.ok) {
      setError(result.reason)
      return
    }

    navigate('/quests')
  }

  const handleArchive = () => {
    if (!editingQuest) return
    archiveQuest(editingQuest.id)
    navigate(-1)
  }

  const mappingModes: Array<{ key: SkillMappingMode; title: string; description: string }> = [
    { key: 'fixed', title: '固定スキル', description: '毎回同じスキルに経験値を加算します。' },
    { key: 'ai_auto', title: 'AI自動判定', description: 'AIが内容に近いスキルを選びます。' },
    { key: 'ask_each_time', title: '毎回確認する', description: 'クリア時に候補からスキルを選びます。' },
  ]

  return (
    <Screen
      title={editingQuest ? 'クエスト編集' : 'クエスト追加'}
      subtitle="育てたい習慣をクエストとして追加します"
      action={
        <Button size="icon" onClick={() => navigate('/settings')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <section>
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">基本情報</div>
              <div className="space-y-3">
                <Input
                  value={form.title}
                  onChange={(event) => update('title', event.target.value)}
                  placeholder="クエスト名"
                />
                <Textarea
                  value={form.description ?? ''}
                  onChange={(event) => update('description', event.target.value)}
                  placeholder="説明を入力"
                />
              </div>
            </div>

            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">種別</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => update('questType', 'repeatable')}
                  className={`rounded-2xl border p-4 text-left shadow-sm ${
                    form.questType === 'repeatable'
                      ? 'border-violet-600 bg-violet-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">繰り返しクエスト</div>
                  <div className="mt-1 text-xs text-slate-500">習慣化したい行動に向いています。</div>
                </button>
                <button
                  type="button"
                  onClick={() => update('questType', 'one_time')}
                  className={`rounded-2xl border p-4 text-left shadow-sm ${
                    form.questType === 'one_time'
                      ? 'border-violet-600 bg-violet-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">単発クエスト</div>
                  <div className="mt-1 text-xs text-slate-500">一度だけ完了するタスクに向いています。</div>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">報酬</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                {xpPresets.map((xp) => (
                  <button
                    key={xp}
                    type="button"
                    onClick={() => update('xpReward', xp)}
                    className={`rounded-2xl px-3 py-3 text-sm font-semibold shadow-sm transition ${
                      form.xpReward === xp
                        ? 'border border-violet-600 bg-violet-50 text-violet-700'
                        : 'border border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {xp} XP
                  </button>
                ))}
                <Input
                  type="number"
                  min={1}
                  max={100}
                  className="h-full bg-white"
                  value={form.xpReward}
                  onChange={(event) => update('xpReward', Number(event.target.value))}
                />
              </div>
            </div>

            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">カテゴリ</div>
              <div className="flex flex-wrap gap-2">
                {QUEST_CATEGORIES.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => update('category', category)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      form.category === category
                        ? 'bg-violet-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">スキル設定方式</div>
            {mappingModes.map((mode) => (
              <button
                key={mode.key}
                type="button"
                disabled={form.privacyMode === 'no_ai' && mode.key !== 'fixed'}
                onClick={() => update('skillMappingMode', mode.key)}
                className={`w-full rounded-2xl border p-4 text-left shadow-sm ${
                  form.skillMappingMode === mode.key
                    ? 'border-violet-600 bg-violet-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                        form.skillMappingMode === mode.key ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {mode.key === 'fixed' ? (
                        <Target className="h-5 w-5" />
                      ) : mode.key === 'ai_auto' ? (
                        <Sparkles className="h-5 w-5" />
                      ) : (
                        <ChevronRight className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{mode.title}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">{mode.description}</div>
                    </div>
                  </div>
                  {mode.key === 'ai_auto' ? <Badge>推奨</Badge> : null}
                </div>
              </button>
            ))}

            {form.skillMappingMode === 'fixed' ? (
              <Select
                value={form.fixedSkillId ?? ''}
                onChange={(event) => update('fixedSkillId', event.target.value || undefined)}
              >
                <option value="">固定スキルを選択</option>
                {skillOptions.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name} / {skill.category}
                  </option>
                ))}
              </Select>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="mt-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">詳細設定</div>
        <div className="space-y-3">
          <Card>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">クールダウン</div>
                <div className="mt-1 text-xs text-slate-500">繰り返しクエストの再実行までの待ち時間です。</div>
              </div>
              <Input
                type="number"
                className="w-28 bg-white"
                min={MIN_REPEATABLE_COOLDOWN}
                max={MAX_REPEATABLE_COOLDOWN}
                step={1}
                disabled={form.questType !== 'repeatable'}
                value={form.cooldownMinutes ?? 30}
                onChange={(event) => update('cooldownMinutes', Number(event.target.value))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">1日上限</div>
                <div className="mt-1 text-xs text-slate-500">1日に何回までクリアできるかを設定します。</div>
              </div>
              <Input
                type="number"
                className="w-28 bg-white"
                min={MIN_REPEATABLE_DAILY_CAP}
                max={MAX_REPEATABLE_DAILY_CAP}
                step={1}
                disabled={form.questType !== 'repeatable'}
                value={form.dailyCompletionCap ?? 1}
                onChange={(event) => update('dailyCompletionCap', Number(event.target.value))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">非AIモード</div>
                  <div className="mt-1 text-xs text-slate-500">機密性が高い内容では固定スキルとテンプレート文だけを使います。</div>
                </div>
                <Switch
                  checked={form.privacyMode === 'no_ai'}
                  onCheckedChange={(checked) => update('privacyMode', checked ? 'no_ai' : settings.defaultPrivacyMode)}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">ピン表示</div>
                  <div className="mt-1 text-xs text-slate-500">ホームのおすすめに出しやすくします。</div>
                </div>
                <Switch checked={form.pinned} onCheckedChange={(checked) => update('pinned', checked)} />
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold text-slate-900">期限</div>
                <Input
                  type="datetime-local"
                  className="bg-white"
                  value={toDateTimeLocalValue(form.dueAt)}
                  onChange={(event) =>
                    update('dueAt', event.target.value ? new Date(event.target.value).toISOString() : undefined)
                  }
                />
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold text-slate-900">リマインド時刻</div>
                <Input
                  type="time"
                  className="bg-white"
                  value={form.reminderTime ?? ''}
                  onChange={(event) => update('reminderTime', event.target.value || undefined)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="mt-5 pb-6">
        <Card className="border-violet-100 bg-violet-50">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Lock className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-violet-950">このクエストの判定メモ</div>
              <div className="mt-1 text-sm text-violet-800">
                {form.privacyMode === 'no_ai'
                  ? '非AIモードなので、固定スキルとテンプレート文のみを使います。'
                  : form.skillMappingMode === 'fixed'
                    ? '固定スキルに直接経験値が入ります。'
                    : form.skillMappingMode === 'ai_auto'
                      ? 'クリア後に AI またはローカル判定で近いスキルを自動で決めます。'
                      : 'クリア後に候補からスキルを選べます。'}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {editingQuest ? (
        <section className="mt-5 space-y-3">
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="space-y-4 p-4">
              <div>
                <div className="text-sm font-semibold text-amber-950">アーカイブ</div>
                <div className="mt-1 text-sm text-amber-800">
                  クエストを非表示にします。履歴は保持され、あとから再オープンできます。
                </div>
              </div>

              <Button variant="secondary" className="w-full" onClick={handleArchive}>
                このクエストをアーカイブする
              </Button>
            </CardContent>
          </Card>

          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="space-y-4 p-4">
              <div>
                <div className="text-sm font-semibold text-rose-950">削除</div>
                <div className="mt-1 text-sm text-rose-800">
                  クエストを完全に削除します。削除後は元に戻せません。
                </div>
              </div>

              <div className="rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 text-xs leading-5 text-rose-700">
                {hasActiveCompletion
                  ? '履歴があるため削除できません。不要化したクエストはアーカイブしてください。'
                  : '完了履歴がないため削除できます。'}
              </div>

              <Button variant="danger" className="w-full" disabled={hasActiveCompletion} onClick={handleDelete}>
                このクエストを削除する
              </Button>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <div className="sticky bottom-[84px] mt-auto border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-12" onClick={() => navigate(-1)}>
            キャンセル
          </Button>
          <Button className="h-12" onClick={save}>
            {editingQuest ? '更新する' : 'クエストを保存'}
          </Button>
        </div>
      </div>
    </Screen>
  )
}
