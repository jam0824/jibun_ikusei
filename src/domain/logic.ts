import { differenceInCalendarDays, differenceInMinutes, isBefore, parseISO, startOfDay, subDays } from 'date-fns'
import {
  DEFAULT_REPEATABLE_COOLDOWN,
  DEFAULT_REPEATABLE_DAILY_CAP,
  MAX_REPEATABLE_COOLDOWN,
  MAX_REPEATABLE_DAILY_CAP,
  MIN_REPEATABLE_COOLDOWN,
  MIN_REPEATABLE_DAILY_CAP,
  QUEST_CATEGORIES,
  SAMPLE_QUESTS,
  SEED_SKILLS,
  SKILL_LEVEL_XP,
  USER_LEVEL_XP,
} from '@/domain/constants'
import {
  createDefaultAiConfig,
  createDefaultMeta,
  createDefaultSettings,
  createDefaultUser,
  createEmptyState,
} from '@/domain/defaults'
import type {
  AiConfig,
  AppMeta,
  AssistantMessage,
  DashboardView,
  PersistedAppState,
  PersonalSkillDictionary,
  Quest,
  QuestAvailability,
  QuestCompletion,
  Skill,
  SkillResolutionResult,
  UserSettings,
} from '@/domain/types'
import {
  formatDate,
  formatTime,
  getDateRangeLast7Days,
  getDayKey,
  getWeekKey,
  isReminderDue,
  isSameCalendarDay,
  isWithinRange,
  nowIso,
} from '@/lib/date'
import { clamp, createId, deepCopy, slugify } from '@/lib/utils'

type MergeableRecord = { id: string; updatedAt?: string; createdAt?: string }

const KEYWORD_RULES = [
  {
    keywords: ['読書', '本', '書籍', '勉強', '学習'],
    skillName: '読書',
    category: '学習',
    confidence: 0.92,
  },
  {
    keywords: ['調べ', '調査', 'リサーチ', '情報整理', 'まとめ'],
    skillName: '調査',
    category: '学習',
    confidence: 0.86,
  },
  {
    keywords: ['エアロバイク', 'バイク', '有酸素', 'ランニング', 'ジョギング', 'ウォーキング', 'cycling'],
    skillName: '有酸素運動',
    category: '運動',
    confidence: 0.94,
  },
  {
    keywords: ['筋トレ', 'スクワット', '腹筋', '腕立て', 'トレーニング'],
    skillName: '筋力トレーニング',
    category: '運動',
    confidence: 0.9,
  },
  {
    keywords: ['ストレッチ', 'ヨガ', '柔軟'],
    skillName: 'ストレッチ',
    category: '運動',
    confidence: 0.88,
  },
  {
    keywords: ['企画', '文章', '資料', '文書', 'メモ', '書く'],
    skillName: '文書作成',
    category: '仕事',
    confidence: 0.9,
  },
  {
    keywords: ['タスク', '予定', '整理', '進行', '管理'],
    skillName: 'タスク管理',
    category: '仕事',
    confidence: 0.86,
  },
  {
    keywords: ['掃除', '洗濯', '片付け', '料理'],
    skillName: '家事',
    category: '生活',
    confidence: 0.88,
  },
  {
    keywords: ['睡眠', '早起き', '食事', '健康'],
    skillName: '健康管理',
    category: '生活',
    confidence: 0.84,
  },
  {
    keywords: ['会話', '連絡', '相談', '対話'],
    skillName: 'コミュニケーション',
    category: '対人',
    confidence: 0.85,
  },
  {
    keywords: ['傾聴', '聞く', 'ヒアリング'],
    skillName: '傾聴',
    category: '対人',
    confidence: 0.82,
  },
  {
    keywords: ['デザイン', 'レイアウト', '配色'],
    skillName: 'デザイン',
    category: '創作',
    confidence: 0.85,
  },
  {
    keywords: ['執筆', 'ライティング', '記事', '文章作成'],
    skillName: 'ライティング',
    category: '創作',
    confidence: 0.84,
  },
] as const

const LEGACY_TEXT_REPLACEMENTS: Record<string, string> = {
  '蟄ｦ鄙・': '学習',
  '驕句虚': '運動',
  '莉穂ｺ・': '仕事',
  '逕滓ｴｻ': '生活',
  '蟇ｾ莠ｺ': '対人',
  '蜑ｵ菴・': '創作',
  '縺昴・莉・': 'その他',
  '隱ｭ譖ｸ': '読書',
  '蟄ｦ鄙堤ｿ呈・': '学習習慣',
  '諠・ｱ謨ｴ逅・': '情報整理',
  '隱ｿ譟ｻ': '調査',
  '譛蛾・邏驕句虚': '有酸素運動',
  '遲句鴨繝医Ξ繝ｼ繝九Φ繧ｰ': '筋力トレーニング',
  '繧ｹ繝医Ξ繝・メ': 'ストレッチ',
  '譁・嶌菴懈・': '文書作成',
  '繧ｿ繧ｹ繧ｯ邂｡逅・': 'タスク管理',
  '髮・ｸｭ菴懈･ｭ': '集中作業',
  '莨∫判險ｭ險・': '企画設計',
  '螳ｶ莠・': '家事',
  '蛛･蠎ｷ邂｡逅・': '健康管理',
  '逹｡逵鄙呈・': '睡眠習慣',
  '繧ｳ繝溘Η繝九こ繝ｼ繧ｷ繝ｧ繝ｳ': 'コミュニケーション',
  '蛯ｾ閨ｴ': '傾聴',
  '豌鈴・繧・': '気配り',
  '繝ｩ繧､繝・ぅ繝ｳ繧ｰ': 'ライティング',
  '繝・じ繧､繝ｳ': 'デザイン',
  '逋ｺ諠ｳ蜉・': '発想力',
  '隱ｭ譖ｸ縺吶ｋ': '読書する',
  '繧ｨ繧｢繝ｭ繝舌う繧ｯ繧呈ｼ輔＄': 'エアロバイクを漕ぐ',
  '莨∫判繝｡繝｢繧・繝壹・繧ｸ譖ｸ縺・': '企画メモを2ページ書く',
  '蟆剰ｪｬ繧・ｮ溽畑譖ｸ繧・0蛻・ｪｭ繧': '気になっている本を10分読む',
  '20蛻・・譛蛾・邏驕句虚繧偵☆繧・': '20分の有酸素運動をする',
  '髮・ｸｭ縺励※繧｢繧､繝・い繧定ｨ隱槫喧縺吶ｋ': '集中してアイデアを言語化する',
  '繝ｪ繝ｪ繧｣': 'リリィ',
  '譛蛻昴・繧ｯ繧ｨ繧ｹ繝医ｒ霑ｽ蜉縺励※縲∽ｻ頑律縺ｮ謌宣聞繧貞ｧ九ａ縺ｾ縺励ｇ縺・・': '最初のクエストを追加して、今日の成長を始めましょう。',
}

function replaceLegacyText(value?: string) {
  if (!value) {
    return value
  }

  return LEGACY_TEXT_REPLACEMENTS[value] ?? value
}

function migrateLegacyContent(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    settings: {
      ...state.settings,
      voiceCharacter: replaceLegacyText(state.settings.voiceCharacter) ?? state.settings.voiceCharacter,
    },
    quests: state.quests.map((quest) => ({
      ...quest,
      title: replaceLegacyText(quest.title) ?? quest.title,
      description: replaceLegacyText(quest.description),
      category: replaceLegacyText(quest.category),
    })),
    completions: state.completions.map((completion) => ({
      ...completion,
      resolutionReason: replaceLegacyText(completion.resolutionReason),
    })),
    skills: state.skills.map((skill) => {
      const name = replaceLegacyText(skill.name) ?? skill.name
      return {
        ...skill,
        name,
        normalizedName: normalizeSkillName(name),
        category: replaceLegacyText(skill.category) ?? skill.category,
      }
    }),
    personalSkillDictionary: state.personalSkillDictionary.map((entry) => ({
      ...entry,
      phrase: replaceLegacyText(entry.phrase) ?? entry.phrase,
    })),
    assistantMessages: state.assistantMessages.map((message) => ({
      ...message,
      text: replaceLegacyText(message.text) ?? message.text,
    })),
  }
}

function compareDates(left?: string, right?: string) {
  const leftValue = left ? new Date(left).getTime() : 0
  const rightValue = right ? new Date(right).getTime() : 0
  return rightValue - leftValue
}

export function normalizeSkillName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, '')
}

export function getLevelFromXp(totalXp: number, stepXp: number) {
  const safeXp = Math.max(0, totalXp)
  const currentXp = safeXp % stepXp
  return {
    level: Math.floor(safeXp / stepXp) + 1,
    totalXp: safeXp,
    currentXp,
    nextStepXp: stepXp - currentXp || stepXp,
    progress: clamp((currentXp / stepXp) * 100, 0, 100),
  }
}

export function createSkillRecord(name: string, category: string, source: Skill['source'] = 'manual'): Skill {
  const now = nowIso()
  return {
    id: `skill_${slugify(name) || createId('skill')}`,
    name,
    normalizedName: normalizeSkillName(name),
    category,
    level: 1,
    totalXp: 0,
    source,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export function getProviderConfig(aiConfig: AiConfig, provider = aiConfig.activeProvider) {
  if (provider === 'none') {
    return undefined
  }

  return aiConfig.providers[provider]
}

export function hasUsableAi(aiConfig: AiConfig, settings: UserSettings, provider = aiConfig.activeProvider) {
  const providerConfig = getProviderConfig(aiConfig, provider)
  return Boolean(settings.aiEnabled && provider !== 'none' && providerConfig?.apiKey)
}

export function resolveMergedSkillId(skillId: string | undefined, skills: Skill[]) {
  if (!skillId) {
    return undefined
  }

  const seen = new Set<string>()
  let current = skillId
  while (current && !seen.has(current)) {
    seen.add(current)
    const skill = skills.find((entry) => entry.id === current)
    if (!skill?.mergedIntoSkillId) {
      return current
    }
    current = skill.mergedIntoSkillId
  }

  return current
}

function findSkillByName(skills: Skill[], skillName: string) {
  const normalized = normalizeSkillName(skillName)
  return skills.find((skill) => skill.status === 'active' && skill.normalizedName === normalized)
}

function ensureSkill(skills: Skill[], skillName: string, category: string, source: Skill['source'] = 'manual') {
  const existing = findSkillByName(skills, skillName)
  if (existing) {
    return { skill: existing, skills }
  }

  const created = createSkillRecord(skillName, category, source)
  return { skill: created, skills: [created, ...skills] }
}

function createSampleState(baseState: PersistedAppState) {
  let skills = [...baseState.skills]
  const quests: Quest[] = SAMPLE_QUESTS.map((sample, index) => {
    const ensured = ensureSkill(skills, sample.skillName, sample.category, 'seed')
    skills = ensured.skills
    const now = nowIso()

    return {
      id: createId('quest'),
      title: sample.title,
      description: sample.description,
      questType: sample.questType,
      xpReward: sample.xpReward,
      category: sample.category,
      skillMappingMode: sample.skillMappingMode,
      fixedSkillId: sample.skillMappingMode === 'fixed' ? ensured.skill.id : undefined,
      defaultSkillId: sample.skillMappingMode === 'ai_auto' ? ensured.skill.id : undefined,
      cooldownMinutes: sample.questType === 'repeatable' ? DEFAULT_REPEATABLE_COOLDOWN * (index + 1) : undefined,
      dailyCompletionCap: sample.questType === 'repeatable' ? DEFAULT_REPEATABLE_DAILY_CAP : undefined,
      status: 'active',
      privacyMode: 'normal',
      pinned: index === 0,
      createdAt: now,
      updatedAt: now,
    }
  })

  return {
    ...baseState,
    quests,
    skills,
    meta: {
      ...baseState.meta,
      seededSampleData: true,
    },
  }
}

function toWholeNumber(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return Math.trunc(value)
}

function normalizeQuestConstraints(quest: Quest): Quest {
  if (quest.questType !== 'repeatable') {
    return {
      ...quest,
      cooldownMinutes: undefined,
      dailyCompletionCap: undefined,
    }
  }

  const cooldown = toWholeNumber(quest.cooldownMinutes)
  const dailyCap = toWholeNumber(quest.dailyCompletionCap)

  return {
    ...quest,
    cooldownMinutes:
      cooldown === undefined ? undefined : clamp(cooldown, MIN_REPEATABLE_COOLDOWN, MAX_REPEATABLE_COOLDOWN),
    dailyCompletionCap:
      dailyCap === undefined ? undefined : clamp(dailyCap, MIN_REPEATABLE_DAILY_CAP, MAX_REPEATABLE_DAILY_CAP),
  }
}

function migrateAiConfig(aiConfig: AiConfig): AiConfig {
  const defaults = createDefaultAiConfig()
  const openai =
    aiConfig.providers.openai.model === 'gpt-5-mini'
      ? { ...aiConfig.providers.openai, model: defaults.providers.openai.model }
      : aiConfig.providers.openai

  const geminiTtsModel =
    aiConfig.providers.gemini.ttsModel === 'gemini-2.5-flash-preview-tts'
      ? defaults.providers.gemini.ttsModel
      : aiConfig.providers.gemini.ttsModel

  const geminiVoice =
    !aiConfig.providers.gemini.voice || aiConfig.providers.gemini.voice === 'Kore'
      ? defaults.providers.gemini.voice
      : aiConfig.providers.gemini.voice

  return {
    ...aiConfig,
    providers: {
      ...aiConfig.providers,
      openai,
      gemini: {
        ...aiConfig.providers.gemini,
        ttsModel: geminiTtsModel,
        voice: geminiVoice,
      },
    },
  }
}

export function hydratePersistedState(partial?: Partial<PersistedAppState>): PersistedAppState {
  const empty = createEmptyState()
  const hydrated: PersistedAppState = {
    user: partial?.user ?? createDefaultUser(),
    settings: partial?.settings ?? createDefaultSettings(),
    aiConfig: partial?.aiConfig
      ? {
          activeProvider: partial.aiConfig.activeProvider ?? empty.aiConfig.activeProvider,
          providers: {
            openai: {
              ...createDefaultAiConfig().providers.openai,
              ...partial.aiConfig.providers?.openai,
            },
            gemini: {
              ...createDefaultAiConfig().providers.gemini,
              ...partial.aiConfig.providers?.gemini,
            },
          },
        }
      : createDefaultAiConfig(),
    quests: partial?.quests ?? [],
    completions: partial?.completions ?? [],
    skills: partial?.skills ?? [],
    personalSkillDictionary: partial?.personalSkillDictionary ?? [],
    assistantMessages: partial?.assistantMessages?.length ? partial.assistantMessages : empty.assistantMessages,
    meta: {
      ...createDefaultMeta(),
      ...partial?.meta,
    },
  }

  hydrated.aiConfig = migrateAiConfig(hydrated.aiConfig)

  const withSamples =
    !hydrated.meta.seededSampleData && hydrated.quests.length === 0
      ? createSampleState(hydrated)
      : hydrated

  return reconcileState(migrateLegacyContent(withSamples))
}

export function getActiveCompletions(completions: QuestCompletion[]) {
  return completions.filter((completion) => !completion.undoneAt)
}

export function getTodayActiveCompletions(
  completions: QuestCompletion[],
  referenceDate = new Date(),
) {
  return getActiveCompletions(completions).filter((completion) =>
    isSameCalendarDay(completion.completedAt, referenceDate),
  )
}

export function getQuestIdsWithActiveCompletions(completions: QuestCompletion[]) {
  return new Set(getActiveCompletions(completions).map((completion) => completion.questId))
}

export function getQuestCompletions(completions: QuestCompletion[], questId: string) {
  return getActiveCompletions(completions)
    .filter((completion) => completion.questId === questId)
    .sort((left, right) => compareDates(left.completedAt, right.completedAt))
}

export function reconcileState(input: PersistedAppState): PersistedAppState {
  const state = deepCopy(input)
  const normalizedQuests = state.quests.map((quest) => normalizeQuestConstraints(quest))
  const activeCompletions = getActiveCompletions(state.completions)
  const skillMap = new Map(
    state.skills.map((skill) => [
      skill.id,
      {
        ...skill,
        level: 1,
        totalXp: 0,
      },
    ]),
  )

  for (const completion of activeCompletions) {
    const resolvedSkillId = resolveMergedSkillId(completion.resolvedSkillId, Array.from(skillMap.values()))
    if (!resolvedSkillId || !completion.skillXpAwarded) {
      continue
    }

    const target = skillMap.get(resolvedSkillId)
    if (target) {
      target.totalXp += completion.skillXpAwarded
      target.level = getLevelFromXp(target.totalXp, SKILL_LEVEL_XP).level
      target.updatedAt = completion.createdAt
    }
  }

  const totalUserXp = activeCompletions.reduce((sum, completion) => sum + completion.userXpAwarded, 0)
  const user = {
    ...state.user,
    totalXp: totalUserXp,
    level: getLevelFromXp(totalUserXp, USER_LEVEL_XP).level,
    updatedAt: nowIso(),
  }

  return {
    ...state,
    quests: normalizedQuests,
    user,
    skills: Array.from(skillMap.values()).sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === 'active' ? -1 : 1
      }
      if (left.totalXp !== right.totalXp) {
        return right.totalXp - left.totalXp
      }
      return left.name.localeCompare(right.name, 'ja')
    }),
  }
}

export function getQuestAvailability(
  inputQuest: Quest,
  completions: QuestCompletion[],
  referenceDate = new Date(),
): QuestAvailability {
  const quest = normalizeQuestConstraints(inputQuest)
  if (quest.status === 'archived') {
    return { canComplete: false, state: 'archived', label: 'アーカイブ済み', countToday: 0 }
  }

  const questCompletions = getQuestCompletions(completions, quest.id)
  const countToday = questCompletions.filter((completion) =>
    isSameCalendarDay(completion.completedAt, referenceDate),
  ).length

  if (quest.questType === 'one_time' && quest.status === 'completed') {
    return { canComplete: false, state: 'completed', label: '完了済み', countToday }
  }

  const dailyCap = quest.dailyCompletionCap ?? DEFAULT_REPEATABLE_DAILY_CAP
  if (
    quest.questType === 'repeatable' &&
    countToday >= dailyCap &&
    (questCompletions.length === 0 ||
      differenceInMinutes(referenceDate, parseISO(questCompletions[0].completedAt)) >=
        (quest.cooldownMinutes ?? DEFAULT_REPEATABLE_COOLDOWN))
  ) {
    return { canComplete: false, state: 'daily_cap_reached', label: `本日 ${countToday}/${dailyCap}`, countToday }
  }

  if (quest.questType === 'repeatable' && questCompletions.length > 0) {
    const latest = questCompletions[0]
    const cooldownMinutes = quest.cooldownMinutes ?? DEFAULT_REPEATABLE_COOLDOWN
    const elapsed = differenceInMinutes(referenceDate, parseISO(latest.completedAt))
    if (elapsed < cooldownMinutes) {
      const nextAvailable = new Date(parseISO(latest.completedAt).getTime() + cooldownMinutes * 60_000)
      return {
        canComplete: false,
        state: 'cooling_down',
        label: `次回可能 ${formatTime(nextAvailable)}`,
        countToday,
        nextAvailableAt: nextAvailable.toISOString(),
      }
    }
  }

  if (quest.dueAt && isBefore(parseISO(quest.dueAt), referenceDate)) {
    return { canComplete: true, state: 'expired', label: '期限切れ', countToday }
  }

  if (quest.dueAt) {
    return { canComplete: true, state: 'clearable', label: `期限 ${formatDate(quest.dueAt)}`, countToday }
  }

  return {
    canComplete: true,
    state: 'clearable',
    label: quest.questType === 'repeatable' ? `本日 ${countToday}/${dailyCap}` : 'クリア可能',
    countToday,
  }
}

function calculateStreakDays(completions: QuestCompletion[]) {
  const dayKeys = Array.from(
    new Set(
      getActiveCompletions(completions)
        .map((completion) => getDayKey(completion.completedAt))
        .sort((left, right) => (left > right ? -1 : 1)),
    ),
  )

  if (dayKeys.length === 0) {
    return 0
  }

  let streak = 0
  let cursor = startOfDay(new Date())
  for (const dayKey of dayKeys) {
    const day = startOfDay(parseISO(`${dayKey}T00:00:00`))
    if (differenceInCalendarDays(cursor, day) === 0) {
      streak += 1
      cursor = subDays(cursor, 1)
      continue
    }
    if (differenceInCalendarDays(cursor, day) === 1 && streak === 0) {
      streak += 1
      cursor = day
      continue
    }
    break
  }

  return streak
}

export function getDashboardView(state: PersistedAppState): DashboardView {
  const todayCompletions = getActiveCompletions(state.completions).filter((completion) =>
    isSameCalendarDay(completion.completedAt, new Date()),
  )
  const todayUserXp = todayCompletions.reduce((sum, completion) => sum + completion.userXpAwarded, 0)
  const skillGainMap = new Map<string, number>()

  for (const completion of todayCompletions) {
    if (completion.resolvedSkillId && completion.skillXpAwarded) {
      const finalSkillId = resolveMergedSkillId(completion.resolvedSkillId, state.skills)
      if (finalSkillId) {
        skillGainMap.set(finalSkillId, (skillGainMap.get(finalSkillId) ?? 0) + completion.skillXpAwarded)
      }
    }
  }

  const topSkillGains = Array.from(skillGainMap.entries())
    .map(([skillId, gain]) => {
      const skill = state.skills.find((entry) => entry.id === skillId)
      return skill ? { skill, gain } : undefined
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => right.gain - left.gain)
    .slice(0, 3)

  const recommendedQuests = [...state.quests]
    .filter((quest) => quest.status !== 'archived')
    .sort((left, right) => {
      const leftAvailability = getQuestAvailability(left, state.completions)
      const rightAvailability = getQuestAvailability(right, state.completions)
      const leftScore = (left.pinned ? 100 : 0) + (leftAvailability.canComplete ? 20 : 0) + left.xpReward
      const rightScore = (right.pinned ? 100 : 0) + (rightAvailability.canComplete ? 20 : 0) + right.xpReward
      return rightScore - leftScore
    })
    .slice(0, 5)

  const latestMessage = [...state.assistantMessages].sort((left, right) => compareDates(left.createdAt, right.createdAt))[0]

  return {
    todayCompletionCount: todayCompletions.length,
    todayUserXp,
    streakDays: calculateStreakDays(state.completions),
    topSkillGains,
    recommendedQuests,
    latestMessage,
  }
}

export function getSevenDaySkillGain(state: PersistedAppState, skillId: string) {
  const { from, to } = getDateRangeLast7Days()
  return getActiveCompletions(state.completions)
    .filter((completion) => completion.resolvedSkillId === skillId && completion.skillXpAwarded)
    .filter((completion) => isWithinRange(completion.completedAt, from, to))
    .reduce((sum, completion) => sum + (completion.skillXpAwarded ?? 0), 0)
}

export function buildTemplateSkillResolution(
  quest: Quest,
  note: string | undefined,
  skills: Skill[],
  dictionary: PersonalSkillDictionary[],
): SkillResolutionResult {
  const haystack = `${quest.title} ${quest.description ?? ''} ${note ?? ''}`.toLowerCase()

  const dictionaryMatch = dictionary.find((entry) => haystack.includes(entry.phrase.toLowerCase()))
  if (dictionaryMatch) {
    const skill = skills.find((entry) => entry.id === dictionaryMatch.mappedSkillId)
    if (skill) {
      return {
        action: 'assign_existing',
        skillName: skill.name,
        category: skill.category,
        confidence: 0.96,
        reason: 'ユーザー辞書に一致したため、既存スキルを再利用しました。',
        candidateSkills: [skill.name],
      }
    }
  }

  const directMatch = skills.find((skill) => haystack.includes(skill.name.toLowerCase()))
  if (directMatch) {
    return {
      action: 'assign_existing',
      skillName: directMatch.name,
      category: directMatch.category,
      confidence: 0.86,
      reason: 'クエスト文面に既存スキル名が含まれていたため再利用しました。',
      candidateSkills: [directMatch.name],
    }
  }

  const keywordMatch = KEYWORD_RULES.find((rule) =>
    rule.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())),
  )
  if (keywordMatch) {
    return {
      action: skills.some((skill) => skill.name === keywordMatch.skillName) ? 'assign_existing' : 'assign_seed',
      skillName: keywordMatch.skillName,
      category: keywordMatch.category,
      confidence: keywordMatch.confidence,
      reason: 'キーワード一致から近いスキルを推定しました。',
      candidateSkills: [keywordMatch.skillName],
    }
  }

  const category =
    quest.category && QUEST_CATEGORIES.includes(quest.category as (typeof QUEST_CATEGORIES)[number])
      ? quest.category
      : 'その他'

  return {
    action: 'unclassified',
    skillName: '未分類',
    category,
    confidence: 0.4,
    reason: 'ローカル判定では十分な手がかりが見つかりませんでした。',
    candidateSkills: SEED_SKILLS.find((group) => group.category === category)?.names.slice(0, 3) ?? [],
  }
}

export function createAssistantMessage(
  triggerType: AssistantMessage['triggerType'],
  text: string,
  mood: AssistantMessage['mood'] = 'bright',
  completionId?: string,
): AssistantMessage {
  return {
    id: createId('msg'),
    triggerType,
    mood,
    text,
    completionId,
    createdAt: nowIso(),
  }
}

export function buildFallbackCompletionMessage(params: {
  quest: Quest
  skill?: Skill
  userLevelUp?: boolean
  skillLevelUp?: boolean
}) {
  const { quest, skill, userLevelUp, skillLevelUp } = params
  if (userLevelUp) {
    return createAssistantMessage(
      'user_level_up',
      `${quest.title}の達成でユーザーレベルが上がりました。今日の積み重ねがしっかり力になっています。`,
      'epic',
    )
  }
  if (skill && skillLevelUp) {
    return createAssistantMessage(
      'skill_level_up',
      `${skill.name}スキルがレベルアップしました。続けた分だけ成長が形になっています。`,
      'playful',
    )
  }
  if (skill) {
    return createAssistantMessage(
      'quest_completed',
      `${quest.title}をクリアしました。${skill.name}が少しずつ育っています。`,
      'bright',
    )
  }
  return createAssistantMessage(
    'quest_completed',
    `${quest.title}をクリアしました。今日の成長がしっかり積み上がっています。`,
    'bright',
  )
}

export function buildQuestDraft(quest?: Quest): Quest {
  const now = nowIso()
  if (quest) {
    return normalizeQuestConstraints(quest)
  }

  return {
    id: createId('quest'),
    title: '',
    description: '',
    questType: 'repeatable',
    xpReward: 5,
    category: '学習',
    skillMappingMode: 'ai_auto',
    cooldownMinutes: DEFAULT_REPEATABLE_COOLDOWN,
    dailyCompletionCap: DEFAULT_REPEATABLE_DAILY_CAP,
    status: 'active',
    privacyMode: 'normal',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function mergeRecordArrays<T extends MergeableRecord>(current: T[], incoming: T[]) {
  const map = new Map(current.map((record) => [record.id, record]))
  for (const record of incoming) {
    const existing = map.get(record.id)
    if (!existing) {
      map.set(record.id, record)
      continue
    }
    const existingTs = new Date(existing.updatedAt ?? existing.createdAt ?? 0).getTime()
    const incomingTs = new Date(record.updatedAt ?? record.createdAt ?? 0).getTime()
    if (incomingTs >= existingTs) {
      map.set(record.id, record)
    }
  }
  return Array.from(map.values())
}

function mergeAiConfigKeepingSecrets(current: AiConfig, incoming?: Partial<AiConfig>): AiConfig {
  if (!incoming) {
    return current
  }
  return {
    activeProvider: incoming.activeProvider ?? current.activeProvider,
    providers: {
      openai: {
        ...current.providers.openai,
        ...incoming.providers?.openai,
        apiKey: incoming.providers?.openai?.apiKey ?? current.providers.openai.apiKey,
      },
      gemini: {
        ...current.providers.gemini,
        ...incoming.providers?.gemini,
        apiKey: incoming.providers?.gemini?.apiKey ?? current.providers.gemini.apiKey,
      },
    },
  }
}

export function prepareExportPayload(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    aiConfig: {
      ...state.aiConfig,
      providers: {
        openai: { ...state.aiConfig.providers.openai, apiKey: undefined },
        gemini: { ...state.aiConfig.providers.gemini, apiKey: undefined },
      },
    },
  }
}

export function mergeImportedState(
  current: PersistedAppState,
  imported: Partial<PersistedAppState>,
  mode: 'merge' | 'replace',
) {
  if (mode === 'replace') {
    return hydratePersistedState({
      user: imported.user ?? createDefaultUser(),
      settings: imported.settings ?? createDefaultSettings(),
      aiConfig: mergeAiConfigKeepingSecrets(current.aiConfig, imported.aiConfig),
      quests: imported.quests ?? [],
      completions: imported.completions ?? [],
      skills: imported.skills ?? [],
      personalSkillDictionary: imported.personalSkillDictionary ?? [],
      assistantMessages: imported.assistantMessages ?? [],
      meta: {
        ...createDefaultMeta(),
        ...imported.meta,
      },
    })
  }

  return hydratePersistedState({
    user: imported.user ? { ...current.user, ...imported.user } : current.user,
    settings: imported.settings ? { ...current.settings, ...imported.settings } : current.settings,
    aiConfig: mergeAiConfigKeepingSecrets(current.aiConfig, imported.aiConfig),
    quests: mergeRecordArrays(current.quests, imported.quests ?? []),
    completions: mergeRecordArrays(current.completions, imported.completions ?? []),
    skills: mergeRecordArrays(current.skills, imported.skills ?? []),
    personalSkillDictionary: mergeRecordArrays(current.personalSkillDictionary, imported.personalSkillDictionary ?? []),
    assistantMessages: mergeRecordArrays(current.assistantMessages, imported.assistantMessages ?? []),
    meta: {
      ...current.meta,
      ...imported.meta,
    },
  })
}

export function maybeCreatePeriodicMessages(state: PersistedAppState) {
  const todayKey = getDayKey(new Date())
  const weekKey = getWeekKey(new Date())
  const nextMeta: AppMeta = { ...state.meta }
  const messages = [...state.assistantMessages]

  if (state.meta.lastDailySummaryDate !== todayKey) {
    messages.unshift(
      createAssistantMessage(
        'daily_summary',
        `今日は${getDashboardView(state).todayCompletionCount}件のクエストを達成しました。良い流れです。`,
        'bright',
      ),
    )
    nextMeta.lastDailySummaryDate = todayKey
  }

  if (state.completions.length > 0 && state.meta.lastWeeklyReflectionWeek !== weekKey) {
    messages.unshift(
      createAssistantMessage(
        'weekly_reflection',
        'この1週間の成長をふりかえって、続けたい流れを見つけましょう。',
        'calm',
      ),
    )
    nextMeta.lastWeeklyReflectionWeek = weekKey
  }

  if (
    state.settings.notificationsEnabled &&
    isReminderDue(state.settings.reminderTime) &&
    state.meta.lastNotificationCheckDate !== todayKey &&
    getDashboardView(state).todayCompletionCount === 0
  ) {
    messages.unshift(
      createAssistantMessage(
        'nudge',
        '今日はまだクエストが進んでいません。小さな一歩から始めてみましょう。',
        'calm',
      ),
    )
    nextMeta.lastNotificationCheckDate = todayKey
  }

  return {
    ...state,
    assistantMessages: messages.sort((left, right) => compareDates(left.createdAt, right.createdAt)).slice(0, 80),
    meta: nextMeta,
  }
}

export function maskApiKey(value?: string) {
  if (!value) {
    return '未設定'
  }
  if (value.length <= 8) {
    return '********'
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

export function getQuestStatusTone(availability: QuestAvailability) {
  switch (availability.state) {
    case 'clearable':
      return 'text-emerald-600'
    case 'cooling_down':
      return 'text-amber-600'
    case 'daily_cap_reached':
      return 'text-slate-500'
    case 'expired':
      return 'text-rose-600'
    case 'completed':
      return 'text-violet-600'
    case 'archived':
      return 'text-slate-400'
  }
}

export function getRelatedSkills(state: PersistedAppState, skill: Skill) {
  return state.skills.filter(
    (entry) => entry.id !== skill.id && entry.status === 'active' && entry.category === skill.category,
  )
}

export function getSkillLinkedQuests(state: PersistedAppState, skillId: string) {
  return state.quests.filter(
    (quest) =>
      quest.fixedSkillId === skillId ||
      quest.defaultSkillId === skillId ||
      state.completions.some(
        (completion) => completion.questId === quest.id && completion.resolvedSkillId === skillId,
      ),
  )
}

export function getSkillRecentCompletions(state: PersistedAppState, skillId: string) {
  return getActiveCompletions(state.completions)
    .filter((completion) => completion.resolvedSkillId === skillId)
    .sort((left, right) => compareDates(left.completedAt, right.completedAt))
}
