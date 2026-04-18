import type { CSSProperties } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Play, ScrollText, Sparkles, Star, Trophy } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { CompletionResolutionCard } from '@/components/completion-resolution-card'
import { SKILL_LEVEL_XP, USER_LEVEL_XP } from '@/domain/constants'
import { getCompletionCelebration, getLevelFromXp } from '@/domain/logic'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Progress } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

const celebrationParticles: CSSProperties[] = [
  {
    left: '8%',
    bottom: '18%',
    width: '14px',
    height: '14px',
    animationDelay: '0ms',
    animationDuration: '2600ms',
  },
  {
    left: '18%',
    bottom: '12%',
    width: '10px',
    height: '10px',
    animationDelay: '180ms',
    animationDuration: '2200ms',
  },
  {
    left: '29%',
    bottom: '22%',
    width: '12px',
    height: '12px',
    animationDelay: '420ms',
    animationDuration: '2500ms',
  },
  {
    left: '42%',
    bottom: '14%',
    width: '16px',
    height: '16px',
    animationDelay: '220ms',
    animationDuration: '2800ms',
  },
  {
    left: '55%',
    bottom: '20%',
    width: '10px',
    height: '10px',
    animationDelay: '560ms',
    animationDuration: '2400ms',
  },
  {
    left: '68%',
    bottom: '11%',
    width: '14px',
    height: '14px',
    animationDelay: '120ms',
    animationDuration: '2700ms',
  },
  {
    left: '80%',
    bottom: '17%',
    width: '12px',
    height: '12px',
    animationDelay: '340ms',
    animationDuration: '2350ms',
  },
  {
    left: '90%',
    bottom: '13%',
    width: '9px',
    height: '9px',
    animationDelay: '620ms',
    animationDuration: '2100ms',
  },
]

const medallionOrbs: CSSProperties[] = [
  {
    top: '-14px',
    left: '-22px',
    width: '28px',
    height: '28px',
    animationDelay: '0ms',
    animationDuration: '2600ms',
  },
  {
    top: '8%',
    right: '-22px',
    width: '22px',
    height: '22px',
    animationDelay: '240ms',
    animationDuration: '2300ms',
  },
  {
    bottom: '4px',
    left: '-12px',
    width: '18px',
    height: '18px',
    animationDelay: '420ms',
    animationDuration: '2800ms',
  },
  {
    bottom: '14%',
    right: '-6px',
    width: '16px',
    height: '16px',
    animationDelay: '120ms',
    animationDuration: '2400ms',
  },
]

const xpRewardOrbs: CSSProperties[] = [
  {
    top: '12px',
    right: '18px',
    width: '20px',
    height: '20px',
    animationDelay: '0ms',
    animationDuration: '2200ms',
  },
  {
    top: '42%',
    left: '12px',
    width: '16px',
    height: '16px',
    animationDelay: '280ms',
    animationDuration: '2400ms',
  },
  {
    bottom: '14px',
    right: '34px',
    width: '14px',
    height: '14px',
    animationDelay: '520ms',
    animationDuration: '2600ms',
  },
]

const skillRewardOrbs: CSSProperties[] = [
  {
    top: '14px',
    left: '20px',
    width: '22px',
    height: '22px',
    animationDelay: '0ms',
    animationDuration: '2300ms',
  },
  {
    top: '40%',
    right: '12px',
    width: '16px',
    height: '16px',
    animationDelay: '300ms',
    animationDuration: '2500ms',
  },
  {
    bottom: '12px',
    left: '34px',
    width: '14px',
    height: '14px',
    animationDelay: '560ms',
    animationDuration: '2700ms',
  },
]

export function ClearEffectScreen() {
  const navigate = useNavigate()
  const { completionId } = useParams<{ completionId: string }>()
  const state = useAppStore()
  const [audioError, setAudioError] = useState<string>()
  const stageRef = useRef<HTMLDivElement>(null)
  const completion = state.completions.find((entry) => entry.id === completionId)
  const quest = completion ? state.quests.find((entry) => entry.id === completion.questId) : undefined
  const skill = completion?.resolvedSkillId
    ? state.skills.find((entry) => entry.id === completion.resolvedSkillId)
    : undefined
  const message = completion?.assistantMessageId
    ? state.assistantMessages.find((entry) => entry.id === completion.assistantMessageId)
    : state.assistantMessages[0]
  const candidateSkills = (completion?.candidateSkillIds ?? [])
    .map((skillId) => state.skills.find((skillEntry) => skillEntry.id === skillId))
    .filter((value): value is NonNullable<typeof value> => Boolean(value))

  const celebration = completion
    ? getCompletionCelebration({
        userTotalXp: state.user.totalXp,
        userXpAwarded: completion.userXpAwarded,
        skillTotalXp: skill?.totalXp,
        skillXpAwarded: completion.skillXpAwarded,
      })
    : { effect: 'clear', userLevelUp: false, skillLevelUp: false }
  const userLevelInfo = getLevelFromXp(state.user.totalXp, USER_LEVEL_XP)
  const userPreviousLevelInfo = completion
    ? getLevelFromXp(Math.max(0, state.user.totalXp - completion.userXpAwarded), USER_LEVEL_XP)
    : userLevelInfo
  const skillLevelInfo = skill ? getLevelFromXp(skill.totalXp, SKILL_LEVEL_XP) : undefined
  const skillPreviousLevelInfo =
    skill && completion
      ? getLevelFromXp(Math.max(0, skill.totalXp - (completion.skillXpAwarded ?? 0)), SKILL_LEVEL_XP)
      : skillLevelInfo
  const isSkillCelebration = celebration.effect === 'skill-level-up'
  const HeroIcon = isSkillCelebration ? Star : Trophy
  const medallionLabel =
    isSkillCelebration && completion?.skillXpAwarded
      ? `+${completion.skillXpAwarded} Skill XP`
      : `+${completion?.userXpAwarded ?? 0} XP`
  const playAssistantMessage = state.playAssistantMessage

  const handlePlayMessage = async (messageId: string) => {
    const error = await playAssistantMessage(messageId)
    setAudioError(error)
  }

  useEffect(() => {
    if (!message?.id || state.settings.lilyAutoPlay !== 'on') {
      return
    }

    void playAssistantMessage(message.id)
  }, [message?.id, playAssistantMessage, state.settings.lilyAutoPlay])

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const resetViewport = () => {
      stageRef.current?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }

    const frameId = window.requestAnimationFrame(resetViewport)
    return () => window.cancelAnimationFrame(frameId)
  }, [completionId])

  if (!completion || !quest) {
    return (
      <Screen title="クリア結果" subtitle="直前のクエスト結果を表示します" withBottomNav={false}>
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            表示できるクリア結果が見つかりませんでした。
          </CardContent>
        </Card>
      </Screen>
    )
  }

  const effectLabel =
    celebration.effect === 'user-level-up'
      ? 'LEVEL UP!'
      : celebration.effect === 'skill-level-up'
        ? 'SKILL LEVEL UP'
        : 'QUEST CLEAR'
  const effectMessage =
    celebration.userLevelUp && celebration.skillLevelUp && skill
      ? `Lv.${userPreviousLevelInfo.level} から Lv.${userLevelInfo.level} へ。${skill.name} も成長しました`
      : celebration.userLevelUp
        ? `ユーザーレベルが Lv.${userLevelInfo.level} にアップしました`
        : celebration.skillLevelUp && skill
          ? `${skill.name} が Lv.${skillLevelInfo?.level ?? skill.level} にアップしました`
          : 'クエスト達成をしっかり記録しました'
  const screenTitle =
    celebration.effect === 'user-level-up'
      ? 'レベルアップ！'
      : celebration.effect === 'skill-level-up'
        ? 'スキルレベルアップ！'
        : 'クエストクリア！'
  const screenSubtitle =
    celebration.effect === 'user-level-up'
      ? '努力がひとつ上のステージに届きました'
      : celebration.effect === 'skill-level-up'
        ? '鍛えたスキルがひとつ上に成長しました'
        : '今日の達成を気持ちよく受け取りましょう'

  return (
    <Screen title={screenTitle} subtitle={screenSubtitle} withBottomNav={false}>
      <div
        ref={stageRef}
        tabIndex={-1}
        className="celebration-stage pb-2 outline-none"
        data-effect={celebration.effect}
      >
        <div className="celebration-overlay" aria-hidden="true">
          <span className="celebration-overlay__flash" />
          <span className="celebration-overlay__halo celebration-overlay__halo--left" />
          <span className="celebration-overlay__halo celebration-overlay__halo--right" />
          <span className="celebration-overlay__ring celebration-overlay__ring--primary" />
          <span className="celebration-overlay__ring celebration-overlay__ring--secondary" />
          {celebrationParticles.map((style, index) => (
            <span key={`particle-${index}`} className="celebration-overlay__particle" style={style} />
          ))}
        </div>

        <Card className="celebration-card overflow-hidden border-0 shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
          <div className="celebration-hero px-5 pb-5 pt-6">
            <div className="flex flex-col items-center text-center">
              <div className="celebration-medallion-wrap">
                {medallionOrbs.map((style, index) => (
                  <span
                    key={`medallion-orb-${index}`}
                    className="celebration-close-orb celebration-close-orb--hero"
                    style={style}
                    aria-hidden="true"
                  />
                ))}
                {isSkillCelebration ? (
                  <div className="celebration-skill-sigil" aria-hidden="true">
                    <span className="celebration-skill-sigil__ring celebration-skill-sigil__ring--outer" />
                    <span className="celebration-skill-sigil__ring celebration-skill-sigil__ring--inner" />
                    <span className="celebration-skill-sigil__spark celebration-skill-sigil__spark--one" />
                    <span className="celebration-skill-sigil__spark celebration-skill-sigil__spark--two" />
                    <span className="celebration-skill-sigil__spark celebration-skill-sigil__spark--three" />
                  </div>
                ) : null}
                <div className={cn('celebration-medallion', isSkillCelebration && 'celebration-medallion--skill')}>
                  <span className="celebration-medallion__ring celebration-medallion__ring--inner" />
                  <span className="celebration-medallion__ring celebration-medallion__ring--outer" />
                  <span className="celebration-medallion__shine" />
                  <span className="celebration-medallion__xp">{medallionLabel}</span>
                  <HeroIcon className="h-10 w-10" />
                </div>
              </div>

              <div className="mt-5 max-w-xl">
                <div className="celebration-chip">
                  <Sparkles className="h-3.5 w-3.5" />
                  {effectLabel}
                </div>
                <div className="celebration-callout">{effectMessage}</div>
                <div className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{quest.title}</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">{quest.description || '説明はまだありません'}</div>
                {isSkillCelebration && skill ? (
                  <div className="celebration-skill-focus">Focus Skill: {skill.name}</div>
                ) : null}
                {celebration.userLevelUp && celebration.skillLevelUp && skill ? (
                  <div className="celebration-support-note">{skill.name} もいっしょにレベルアップしました</div>
                ) : null}
              </div>
            </div>
          </div>

          <CardContent className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="celebration-reward-card celebration-reward-card--xp rounded-3xl border p-4 text-center">
                {xpRewardOrbs.map((style, index) => (
                  <span
                    key={`xp-orb-${index}`}
                    className="celebration-close-orb celebration-close-orb--xp"
                    style={style}
                    aria-hidden="true"
                  />
                ))}
                <div className="text-xs font-medium text-violet-700">獲得XP</div>
                <div className="celebration-reward-value mt-2 text-3xl font-black tracking-tight text-violet-900">
                  +{completion.userXpAwarded}
                </div>
                <div className="mt-1 text-xs text-violet-700/80">User XP</div>
              </div>
              <div className="celebration-reward-card celebration-reward-card--skill rounded-3xl border p-4 text-center">
                {skillRewardOrbs.map((style, index) => (
                  <span
                    key={`skill-orb-${index}`}
                    className="celebration-close-orb celebration-close-orb--skill"
                    style={style}
                    aria-hidden="true"
                  />
                ))}
                <div className="text-xs font-medium text-emerald-700">スキル</div>
                <div className="mt-2 text-lg font-black tracking-tight text-emerald-900">{skill?.name ?? '判定中'}</div>
                <div className="mt-1 text-xs text-emerald-700/80">
                  {completion.skillXpAwarded ? `+${completion.skillXpAwarded} Skill XP` : 'スキル判定を進めています'}
                </div>
              </div>
            </div>

            <Card
              className={cn(
                'celebration-growth-card celebration-growth-card--user',
                celebration.userLevelUp && 'celebration-growth-card--active',
              )}
            >
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Trophy className="h-4 w-4 text-amber-500" />
                    ユーザー成長
                  </div>
                  {celebration.userLevelUp ? <Badge className="celebration-inline-badge">LEVEL UP!</Badge> : null}
                </div>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="celebration-level-value text-2xl font-black tracking-tight text-slate-900">
                      Lv.{userLevelInfo.level}
                    </div>
                    {celebration.userLevelUp ? (
                      <div className="mt-1 text-sm font-semibold text-amber-700">
                        Lv.{userPreviousLevelInfo.level} から到達
                      </div>
                    ) : null}
                    <div className="mt-1 text-sm text-slate-500">次のレベルまであと {userLevelInfo.nextStepXp}XP</div>
                  </div>
                  <Badge>{state.user.totalXp} XP</Badge>
                </div>
                <Progress
                  value={userLevelInfo.progress}
                  className={cn(celebration.userLevelUp && 'celebration-progress')}
                />
              </CardContent>
            </Card>

            {skill && skillLevelInfo && skillPreviousLevelInfo ? (
              <Card
                className={cn(
                  'celebration-growth-card celebration-growth-card--skill',
                  celebration.skillLevelUp && 'celebration-growth-card--active',
                  isSkillCelebration && 'celebration-growth-card--skill-spotlight',
                )}
              >
                <CardContent className="p-4">
                  {isSkillCelebration ? <div className="celebration-skill-spotlight" aria-hidden="true" /> : null}
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Star className="h-4 w-4 text-fuchsia-500" />
                      スキル成長
                    </div>
                    {celebration.skillLevelUp ? (
                      <Badge className="celebration-inline-badge celebration-inline-badge--skill">
                        SKILL UP
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                      <div className="celebration-level-value text-lg font-black tracking-tight text-slate-900">
                        {skill.name} Lv.{skillLevelInfo.level}
                      </div>
                      {celebration.skillLevelUp ? (
                        <div className="mt-1 text-sm font-semibold text-fuchsia-700">
                          Lv.{skillPreviousLevelInfo.level} から到達
                        </div>
                      ) : null}
                      <div className="mt-1 text-sm text-slate-500">次のレベルまであと {skillLevelInfo.nextStepXp}XP</div>
                    </div>
                    <Badge>{skill.totalXp} XP</Badge>
                  </div>
                  <Progress
                    value={skillLevelInfo.progress}
                    className={cn(celebration.skillLevelUp && 'celebration-progress celebration-progress--skill')}
                  />
                </CardContent>
              </Card>
            ) : null}

            <Card className="celebration-comment-card border-violet-100 bg-violet-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                    <Star className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-violet-900">リリィ</div>
                      <Badge tone="outline">コメント</Badge>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-violet-700">
                      {message?.text ?? 'ナイスです。今日の達成がしっかり記録されました。'}
                    </div>
                  </div>
                  {message ? (
                    <Button
                      size="icon"
                      variant="outline"
                      className="rounded-2xl bg-white"
                      onClick={() => void handlePlayMessage(message.id)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
                {audioError ? (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-800">
                    {audioError}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <CompletionResolutionCard
              completion={completion}
              candidates={candidateSkills}
              onSelect={(skillId) => state.confirmCompletionSkill(completion.id, skillId)}
            />

            <div className="grid grid-cols-2 gap-3 pt-1">
              <Button
                variant="outline"
                className="h-12"
                onClick={() => navigate('/records/growth?range=today')}
              >
                <ScrollText className="h-4 w-4" />
                記録を見る
              </Button>
              <Button className="h-12" onClick={() => navigate('/')}>
                ホームへ戻る
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Screen>
  )
}
