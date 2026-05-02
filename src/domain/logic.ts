import { addDays, differenceInCalendarDays, differenceInMinutes, endOfDay, isBefore, parseISO, startOfDay, subDays, subWeeks } from 'date-fns'
import {
  DEFAULT_REPEATABLE_COOLDOWN,
  DEFAULT_REPEATABLE_DAILY_CAP,
  GEMINI_MODELS,
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
  ScrapArticle,
  Skill,
  SkillResolutionResult,
  StatusCategorySummary,
  StatusGrowthSummary,
  StatusView,
  UserSettings,
} from '@/domain/types'
import {
  formatDate,
  formatTime,
  getDateRangeLast7Days,
  getDayKey,
  getPreviousWeekDateRange,
  getWeekDateRange,
  getWeekKey,
  isReminderDue,
  isSameCalendarDay,
  isWithinRange,
  nowIso,
} from '@/lib/date'
import { clamp, createId, deepCopy, slugify } from '@/lib/utils'

type MergeableRecord = { id: string; updatedAt?: string; createdAt?: string }

const PERIODIC_WEEKLY_REFLECTION_MESSAGES_ENABLED = false

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

const STATUS_CATEGORY_CONFIG = [
  { category: '学習', label: '知識' },
  { category: '運動', label: '体力' },
  { category: '仕事', label: '実務' },
  { category: '生活', label: '生活' },
  { category: '対人', label: '対話' },
  { category: '創作', label: '創造' },
] as const

const STATUS_CATEGORY_ORDER = new Map<string, number>(
  STATUS_CATEGORY_CONFIG.map((entry, index) => [entry.category, index]),
)

const STATUS_CATEGORY_LABELS = new Map<string, string>(
  STATUS_CATEGORY_CONFIG.map((entry) => [entry.category, entry.label]),
)

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

export type CompletionHistoryFilter = 'today' | 'week' | 'all'
export type QuestCompletionRankingFilter = Extract<CompletionHistoryFilter, 'week' | 'all'>

export interface QuestCompletionRankingEntry {
  questId: string
  title: string
  currentCount: number
  previousWeekCount?: number
  lastCompletedAt: string
}

export interface WeeklyReflectionDaySummary {
  dayKey: string
  label: string
  completionCount: number
  userXp: number
}

export interface WeeklyReflectionDailyQuestSummary {
  questId: string
  title: string
  currentDays: number
  previousDays: number
}

export interface WeeklyReflectionQuestSummary {
  questId: string
  title: string
  currentCount: number
  previousCount: number
  lastCompletedAt: string
}

export interface WeeklyReflectionSkillSummary {
  skillId: string
  skillName: string
  currentXp: number
}

export interface WeeklyReflectionSummary {
  weekKey: string
  previousWeekKey: string
  weekLabel: string
  startDate: string
  endDate: string
  totalCompletionCount: number
  totalUserXp: number
  activeDayCount: number
  topSkill?: WeeklyReflectionSkillSummary
  dailySummaries: WeeklyReflectionDaySummary[]
  dailyQuestSummaries: WeeklyReflectionDailyQuestSummary[]
  topQuestSummaries: WeeklyReflectionQuestSummary[]
  topSkillSummaries: WeeklyReflectionSkillSummary[]
  hasData: boolean
}

export interface WeeklyReflectionStatus {
  weekKey: string
  available: boolean
  unread: boolean
}

const DELETED_QUEST_TITLE = '削除されたクエスト'
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const
const LEGACY_SEED_QUEST_TITLES = new Set(SAMPLE_QUESTS.map((sample) => sample.title.trim()))

export function normalizeSkillName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, '')
}

function isValidDateValue(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function isQuestSource(value: unknown): value is Quest['source'] {
  return value === 'manual' || value === 'browsing' || value === 'seed' || value === 'system'
}

function isQuestTypeValue(value: unknown): value is Quest['questType'] {
  return value === 'repeatable' || value === 'one_time'
}

function isSkillMappingModeValue(value: unknown): value is Quest['skillMappingMode'] {
  return value === 'fixed' || value === 'ai_auto' || value === 'ask_each_time'
}

function isQuestStatusValue(value: unknown): value is Quest['status'] {
  return value === 'active' || value === 'completed' || value === 'archived'
}

function isPrivacyModeValue(value: unknown): value is Quest['privacyMode'] {
  return value === 'normal' || value === 'no_ai'
}

function isBrowsingQuestTypeValue(value: unknown): value is Quest['browsingType'] {
  return value === 'good' || value === 'bad'
}

function isSkillSourceValue(value: unknown): value is Skill['source'] {
  return value === 'manual' || value === 'ai' || value === 'seed'
}

function isSkillStatusValue(value: unknown): value is Skill['status'] {
  return value === 'active' || value === 'merged'
}

function isScrapArticleStatusValue(value: unknown): value is ScrapArticle['status'] {
  return value === 'unread' || value === 'read' || value === 'archived'
}

function isScrapArticleAddedFromValue(value: unknown): value is ScrapArticle['addedFrom'] {
  return value === 'android-share' || value === 'manual'
}

function sanitizeQuestRecord(quest: Partial<Quest>): Quest | null {
  if (typeof quest.id !== 'string' || quest.id.length === 0) {
    return null
  }

  const title = typeof quest.title === 'string' ? quest.title.trim() : ''
  if (!title) {
    return null
  }

  const createdAtFallback = isValidDateValue(quest.createdAt)
    ? quest.createdAt
    : isValidDateValue(quest.updatedAt)
      ? quest.updatedAt
      : nowIso()
  const updatedAt = isValidDateValue(quest.updatedAt) ? quest.updatedAt : createdAtFallback
  const createdAt = isValidDateValue(quest.createdAt) ? quest.createdAt : updatedAt
  const questType = isQuestTypeValue(quest.questType) ? quest.questType : 'repeatable'

  return {
    id: quest.id,
    title,
    description: typeof quest.description === 'string' ? quest.description : '',
    questType,
    isDaily: questType === 'repeatable' && quest.isDaily === true ? true : undefined,
    xpReward: typeof quest.xpReward === 'number' && Number.isFinite(quest.xpReward) ? quest.xpReward : 0,
    category: typeof quest.category === 'string' ? quest.category : undefined,
    skillMappingMode: isSkillMappingModeValue(quest.skillMappingMode)
      ? quest.skillMappingMode
      : typeof quest.fixedSkillId === 'string'
        ? 'fixed'
        : 'ai_auto',
    fixedSkillId: typeof quest.fixedSkillId === 'string' ? quest.fixedSkillId : undefined,
    defaultSkillId: typeof quest.defaultSkillId === 'string' ? quest.defaultSkillId : undefined,
    cooldownMinutes:
      typeof quest.cooldownMinutes === 'number' && Number.isFinite(quest.cooldownMinutes)
        ? quest.cooldownMinutes
        : undefined,
    dailyCompletionCap:
      typeof quest.dailyCompletionCap === 'number' && Number.isFinite(quest.dailyCompletionCap)
        ? quest.dailyCompletionCap
        : undefined,
    dueAt: isValidDateValue(quest.dueAt) ? quest.dueAt : undefined,
    reminderTime: typeof quest.reminderTime === 'string' ? quest.reminderTime : undefined,
    status: isQuestStatusValue(quest.status) ? quest.status : 'active',
    privacyMode: isPrivacyModeValue(quest.privacyMode) ? quest.privacyMode : 'normal',
    pinned: quest.pinned === true,
    source: isQuestSource(quest.source) ? quest.source : undefined,
    systemKey: quest.systemKey === 'meal_register' ? quest.systemKey : undefined,
    domain: typeof quest.domain === 'string' ? quest.domain : undefined,
    browsingCategory: typeof quest.browsingCategory === 'string' ? quest.browsingCategory : undefined,
    browsingType: isBrowsingQuestTypeValue(quest.browsingType) ? quest.browsingType : undefined,
    createdAt,
    updatedAt,
  }
}

function sanitizeQuestRecords(quests: Quest[]) {
  return quests
    .map((quest) => sanitizeQuestRecord(quest))
    .filter((quest): quest is Quest => Boolean(quest))
}

function sanitizeSkillRecord(skill: Partial<Skill>): Skill | null {
  if (typeof skill.id !== 'string' || skill.id.length === 0) {
    return null
  }

  const createdAtFallback = isValidDateValue(skill.createdAt)
    ? skill.createdAt
    : isValidDateValue(skill.updatedAt)
      ? skill.updatedAt
      : nowIso()
  const updatedAt = isValidDateValue(skill.updatedAt) ? skill.updatedAt : createdAtFallback
  const createdAt = isValidDateValue(skill.createdAt) ? skill.createdAt : updatedAt
  const fallbackName =
    typeof skill.mergedIntoSkillId === 'string' && skill.mergedIntoSkillId.length > 0
      ? skill.mergedIntoSkillId
      : '統合済みスキル'
  const name = typeof skill.name === 'string' && skill.name.trim().length > 0 ? skill.name.trim() : fallbackName

  return {
    id: skill.id,
    name,
    normalizedName:
      typeof skill.normalizedName === 'string' && skill.normalizedName.length > 0
        ? skill.normalizedName
        : normalizeSkillName(name),
    category: typeof skill.category === 'string' && skill.category.length > 0 ? skill.category : 'その他',
    level: typeof skill.level === 'number' && Number.isFinite(skill.level) ? skill.level : 1,
    totalXp: typeof skill.totalXp === 'number' && Number.isFinite(skill.totalXp) ? skill.totalXp : 0,
    source: isSkillSourceValue(skill.source) ? skill.source : 'manual',
    status: isSkillStatusValue(skill.status) ? skill.status : 'active',
    mergedIntoSkillId:
      typeof skill.mergedIntoSkillId === 'string' && skill.mergedIntoSkillId.length > 0
        ? skill.mergedIntoSkillId
        : undefined,
    createdAt,
    updatedAt,
  }
}

function sanitizeSkillRecords(skills: Skill[]) {
  return skills
    .map((skill) => sanitizeSkillRecord(skill))
    .filter((skill): skill is Skill => Boolean(skill))
}

function sanitizeScrapArticleRecord(scrap: Partial<ScrapArticle>): ScrapArticle | null {
  if (typeof scrap.id !== 'string' || scrap.id.length === 0) {
    return null
  }

  const url = typeof scrap.url === 'string' ? scrap.url.trim() : ''
  const canonicalUrl = typeof scrap.canonicalUrl === 'string' ? scrap.canonicalUrl.trim() : ''
  const title = typeof scrap.title === 'string' ? scrap.title.trim() : ''
  const domain = typeof scrap.domain === 'string' ? scrap.domain.trim() : ''
  if (!url || !canonicalUrl || !title || !domain) {
    return null
  }

  const createdAtFallback = isValidDateValue(scrap.createdAt)
    ? scrap.createdAt
    : isValidDateValue(scrap.updatedAt)
      ? scrap.updatedAt
      : nowIso()
  const updatedAt = isValidDateValue(scrap.updatedAt) ? scrap.updatedAt : createdAtFallback
  const createdAt = isValidDateValue(scrap.createdAt) ? scrap.createdAt : updatedAt

  return {
    id: scrap.id,
    url,
    canonicalUrl,
    title,
    domain,
    sourceText: typeof scrap.sourceText === 'string' ? scrap.sourceText : undefined,
    memo: typeof scrap.memo === 'string' ? scrap.memo : undefined,
    status: isScrapArticleStatusValue(scrap.status) ? scrap.status : 'unread',
    addedFrom: isScrapArticleAddedFromValue(scrap.addedFrom) ? scrap.addedFrom : 'manual',
    createdAt,
    updatedAt,
    readAt: isValidDateValue(scrap.readAt) ? scrap.readAt : undefined,
    archivedAt: isValidDateValue(scrap.archivedAt) ? scrap.archivedAt : undefined,
  }
}

function sanitizeScrapArticleRecords(scraps: ScrapArticle[]) {
  return scraps
    .map((scrap) => sanitizeScrapArticleRecord(scrap))
    .filter((scrap): scrap is ScrapArticle => Boolean(scrap))
}

export function normalizeQuestTitleForDuplicateKey(title?: string) {
  return typeof title === 'string' ? title.trim() : ''
}

export function isLegacySeedQuestTitle(title: string) {
  const normalizedTitle = normalizeQuestTitleForDuplicateKey(title)
  return normalizedTitle.length > 0 && LEGACY_SEED_QUEST_TITLES.has(normalizedTitle)
}

export function isSeedQuest(quest: Pick<Quest, 'title' | 'source'>) {
  return quest.source === 'seed' || (!quest.source && isLegacySeedQuestTitle(quest.title))
}

export function isSystemQuest(quest: Pick<Quest, 'source' | 'systemKey'>) {
  return quest.source === 'system' || Boolean(quest.systemKey)
}

export function getAutoQuestDuplicateKey(quest: Pick<Quest, 'title' | 'source' | 'systemKey'>) {
  if (quest.systemKey && isSystemQuest(quest)) {
    return `system:${quest.systemKey}`
  }

  if (isSeedQuest(quest)) {
    return `seed:${normalizeQuestTitleForDuplicateKey(quest.title)}`
  }

  return undefined
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

function didGainLevel(totalXp: number, awardedXp: number | undefined, stepXp: number) {
  const safeAwardedXp = Math.max(0, awardedXp ?? 0)
  if (safeAwardedXp === 0) {
    return false
  }

  const afterLevel = getLevelFromXp(totalXp, stepXp).level
  const beforeLevel = getLevelFromXp(Math.max(0, totalXp - safeAwardedXp), stepXp).level
  return afterLevel > beforeLevel
}

export function getCompletionCelebration(params: {
  userTotalXp: number
  userXpAwarded: number
  skillTotalXp?: number
  skillXpAwarded?: number
}) {
  const userLevelUp = didGainLevel(params.userTotalXp, params.userXpAwarded, USER_LEVEL_XP)
  const skillLevelUp =
    typeof params.skillTotalXp === 'number'
      ? didGainLevel(params.skillTotalXp, params.skillXpAwarded, SKILL_LEVEL_XP)
      : false

  return {
    effect: userLevelUp ? 'user-level-up' : skillLevelUp ? 'skill-level-up' : 'clear',
    userLevelUp,
    skillLevelUp,
  } as const
}

export function createSkillRecord(name: string, category: string, source: Skill['source'] = 'manual'): Skill {
  const now = nowIso()
  return {
    id: `skill_${slugify(name)}_${createId('s')}`,
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

export function findActiveSkillByName(skills: Skill[], skillName: string) {
  const normalized = normalizeSkillName(skillName)
  return skills.find((skill) => skill.status === 'active' && skill.normalizedName === normalized)
}

function ensureSkill(skills: Skill[], skillName: string, category: string, source: Skill['source'] = 'manual') {
  const existing = findActiveSkillByName(skills, skillName)
  if (existing) {
    return { skill: existing, skills }
  }

  const created = createSkillRecord(skillName, category, source)
  return { skill: created, skills: [created, ...skills] }
}

export function ensureSystemQuests(baseState: PersistedAppState): PersistedAppState {
  const mealQuests = baseState.quests.filter((q) => q.systemKey === 'meal_register')

  // 重複があれば最初の1件だけ残す
  if (mealQuests.length > 1) {
    const keepId = mealQuests[0].id
    return {
      ...baseState,
      quests: baseState.quests.filter((q) => q.systemKey !== 'meal_register' || q.id === keepId),
    }
  }

  if (mealQuests.length === 1) {
    return baseState
  }

  let skills = [...baseState.skills]
  const ensured = ensureSkill(skills, '健康管理', '生活', 'seed')
  skills = ensured.skills
  const now = nowIso()

  const mealRegisterQuest: Quest = {
    id: createId('quest'),
    title: '食事登録',
    description: '食事のスクリーンショットを登録する',
    questType: 'repeatable',
    xpReward: 2,
    category: '生活',
    skillMappingMode: 'fixed',
    fixedSkillId: ensured.skill.id,
    cooldownMinutes: 0,
    dailyCompletionCap: 4,
    status: 'active',
    privacyMode: 'normal',
    pinned: false,
    source: 'system',
    systemKey: 'meal_register',
    createdAt: now,
    updatedAt: now,
  }

  return {
    ...baseState,
    quests: [...baseState.quests, mealRegisterQuest],
    skills,
  }
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
      source: 'seed',
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
      isDaily: undefined,
      cooldownMinutes: undefined,
      dailyCompletionCap: undefined,
    }
  }

  const cooldown = toWholeNumber(quest.cooldownMinutes)
  const dailyCap = toWholeNumber(quest.dailyCompletionCap)

  return {
    ...quest,
    isDaily: quest.isDaily === true ? true : undefined,
    cooldownMinutes:
      cooldown === undefined ? undefined : clamp(cooldown, MIN_REPEATABLE_COOLDOWN, MAX_REPEATABLE_COOLDOWN),
    dailyCompletionCap:
      dailyCap === undefined ? undefined : clamp(dailyCap, MIN_REPEATABLE_DAILY_CAP, MAX_REPEATABLE_DAILY_CAP),
  }
}

const LEGACY_GEMINI_TTS_MODEL_ALIASES: Record<string, string> = {
  'gemini-2.5-flash-tts': GEMINI_MODELS.tts,
  'gemini-2.5-flash-lite-tts': GEMINI_MODELS.tts,
  'gemini-2.5-flash-lite-preview-tts': GEMINI_MODELS.tts,
  'gemini-2.5-pro-preview-tts': 'gemini-2.5-pro-tts',
}

const SUPPORTED_GEMINI_TTS_MODELS = new Set<string>([GEMINI_MODELS.tts, 'gemini-2.5-pro-tts'])

function normalizeGeminiTtsModel(ttsModel?: string) {
  if (!ttsModel) {
    return GEMINI_MODELS.tts
  }

  const migrated = LEGACY_GEMINI_TTS_MODEL_ALIASES[ttsModel]
  if (migrated) {
    return migrated
  }

  return SUPPORTED_GEMINI_TTS_MODELS.has(ttsModel) ? ttsModel : GEMINI_MODELS.tts
}

function migrateAiConfig(aiConfig: AiConfig): AiConfig {
  const defaults = createDefaultAiConfig()
  const openai =
    aiConfig.providers.openai.model === 'gpt-5-mini'
      ? { ...aiConfig.providers.openai, model: defaults.providers.openai.model }
      : aiConfig.providers.openai

  const geminiTtsModel = normalizeGeminiTtsModel(aiConfig.providers.gemini.ttsModel)

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
    quests: sanitizeQuestRecords(partial?.quests ?? []),
    completions: partial?.completions ?? [],
    skills: sanitizeSkillRecords(partial?.skills ?? []),
    personalSkillDictionary: partial?.personalSkillDictionary ?? [],
    assistantMessages: partial?.assistantMessages?.length ? partial.assistantMessages : empty.assistantMessages,
    scrapArticles: sanitizeScrapArticleRecords(partial?.scrapArticles ?? []),
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

  return reconcileState(ensureSystemQuests(migrateLegacyContent(withSamples)))
}

export function getActiveCompletions(completions: QuestCompletion[]) {
  return completions.filter((completion) => !completion.undoneAt)
}

export function getFilteredActiveCompletions(
  completions: QuestCompletion[],
  filter: CompletionHistoryFilter,
  referenceDate = new Date(),
) {
  const activeCompletions = getActiveCompletions(completions)

  if (filter === 'all') {
    return [...activeCompletions].sort((left, right) => compareDates(left.completedAt, right.completedAt))
  }

  return activeCompletions
    .filter((completion) =>
      filter === 'today'
        ? isSameCalendarDay(completion.completedAt, referenceDate)
        : getWeekKey(completion.completedAt) === getWeekKey(referenceDate),
    )
    .sort((left, right) => compareDates(left.completedAt, right.completedAt))
}

export function getTodayActiveCompletions(
  completions: QuestCompletion[],
  referenceDate = new Date(),
) {
  return getFilteredActiveCompletions(completions, 'today', referenceDate)
}

export function getWeekActiveCompletions(
  completions: QuestCompletion[],
  referenceDate = new Date(),
) {
  return getFilteredActiveCompletions(completions, 'week', referenceDate)
}

export function getQuestCompletionRanking(
  quests: Quest[],
  completions: QuestCompletion[],
  filter: QuestCompletionRankingFilter,
  referenceDate = new Date(),
): QuestCompletionRankingEntry[] {
  const activeCompletions = getActiveCompletions(completions)
  const titleByQuestId = new Map(quests.map((quest) => [quest.id, quest.title]))
  const currentWeekKey = filter === 'week' ? getWeekKey(referenceDate) : undefined
  const previousWeekKey = filter === 'week' ? getWeekKey(subDays(referenceDate, 7)) : undefined
  const rankingMap = new Map<string, Required<QuestCompletionRankingEntry>>()

  for (const completion of activeCompletions) {
    const completionWeekKey = filter === 'week' ? getWeekKey(completion.completedAt) : undefined
    if (
      filter === 'week' &&
      completionWeekKey !== currentWeekKey &&
      completionWeekKey !== previousWeekKey
    ) {
      continue
    }

    const existing = rankingMap.get(completion.questId) ?? {
      questId: completion.questId,
      title: titleByQuestId.get(completion.questId) ?? DELETED_QUEST_TITLE,
      currentCount: 0,
      previousWeekCount: 0,
      lastCompletedAt: completion.completedAt,
    }

    if (filter === 'week') {
      if (completionWeekKey === currentWeekKey) {
        existing.currentCount += 1
        if (new Date(completion.completedAt).getTime() > new Date(existing.lastCompletedAt).getTime()) {
          existing.lastCompletedAt = completion.completedAt
        }
      } else {
        existing.previousWeekCount += 1
      }
    } else {
      existing.currentCount += 1
      if (new Date(completion.completedAt).getTime() > new Date(existing.lastCompletedAt).getTime()) {
        existing.lastCompletedAt = completion.completedAt
      }
    }

    rankingMap.set(completion.questId, existing)
  }

  return Array.from(rankingMap.values())
    .filter((entry) => entry.currentCount > 0)
    .sort((left, right) => {
      if (right.currentCount !== left.currentCount) {
        return right.currentCount - left.currentCount
      }

      const completionOrder = compareDates(left.lastCompletedAt, right.lastCompletedAt)
      if (completionOrder !== 0) {
        return completionOrder
      }

      const titleOrder = left.title.localeCompare(right.title, 'ja')
      if (titleOrder !== 0) {
        return titleOrder
      }

      return left.questId.localeCompare(right.questId)
    })
    .slice(0, 10)
    .map((entry) =>
      filter === 'week'
        ? entry
        : {
            questId: entry.questId,
            title: entry.title,
            currentCount: entry.currentCount,
            lastCompletedAt: entry.lastCompletedAt,
          },
    )
}

function isWeeklyReflectionQuest(quest: Quest | undefined) {
  return quest?.source !== 'browsing'
}

function countCompletionDays(completions: QuestCompletion[], questId: string) {
  return new Set(
    completions
      .filter((completion) => completion.questId === questId)
      .map((completion) => getDayKey(completion.completedAt)),
  ).size
}

export function getPreviousWeekReflectionSummary(
  state: Pick<PersistedAppState, 'quests' | 'completions' | 'skills'>,
  referenceDate = new Date(),
): WeeklyReflectionSummary {
  const targetDate = subWeeks(referenceDate, 1)
  const { start, end } = getPreviousWeekDateRange(referenceDate)
  const weekKey = getWeekKey(targetDate)
  const previousWeekKey = getWeekKey(subWeeks(targetDate, 1))
  const startDate = formatDate(start, 'yyyy-MM-dd')
  const endDate = formatDate(end, 'yyyy-MM-dd')
  const weekLabel = `${startDate} 〜 ${endDate}`
  const questMap = new Map(state.quests.map((quest) => [quest.id, quest]))
  const includedCompletions = getActiveCompletions(state.completions).filter((completion) =>
    isWeeklyReflectionQuest(questMap.get(completion.questId)),
  )
  const currentWeekCompletions = includedCompletions.filter(
    (completion) => getWeekKey(completion.completedAt) === weekKey,
  )
  const previousWeekCompletions = includedCompletions.filter(
    (completion) => getWeekKey(completion.completedAt) === previousWeekKey,
  )
  const dailySummaries = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(start, index)
    const dayKey = formatDate(day, 'yyyy-MM-dd')
    const dayCompletions = currentWeekCompletions.filter(
      (completion) => getDayKey(completion.completedAt) === dayKey,
    )

    return {
      dayKey,
      label: WEEKDAY_LABELS[index] ?? '',
      completionCount: dayCompletions.length,
      userXp: dayCompletions.reduce((sum, completion) => sum + completion.userXpAwarded, 0),
    }
  })
  const topQuestSummaries = getQuestCompletionRanking(
    state.quests.filter((quest) => quest.source !== 'browsing'),
    includedCompletions,
    'week',
    targetDate,
  )
    .slice(0, 5)
    .map((entry) => ({
      questId: entry.questId,
      title: entry.title,
      currentCount: entry.currentCount,
      previousCount: entry.previousWeekCount ?? 0,
      lastCompletedAt: entry.lastCompletedAt,
    }))

  const dailyQuestSummaries = state.quests
    .filter((quest) => quest.status !== 'archived' && isDailyQuest(quest) && quest.source !== 'browsing')
    .map((quest) => ({
      questId: quest.id,
      title: quest.title,
      currentDays: countCompletionDays(currentWeekCompletions, quest.id),
      previousDays: countCompletionDays(previousWeekCompletions, quest.id),
    }))
    .filter((entry) => entry.currentDays > 0 || entry.previousDays > 0)
    .sort((left, right) => {
      if (right.currentDays !== left.currentDays) {
        return right.currentDays - left.currentDays
      }
      if (right.previousDays !== left.previousDays) {
        return right.previousDays - left.previousDays
      }
      return left.title.localeCompare(right.title, 'ja')
    })

  const skillXpById = new Map<string, number>()
  for (const completion of currentWeekCompletions) {
    if (!completion.skillXpAwarded) {
      continue
    }

    const finalSkillId =
      resolveMergedSkillId(completion.resolvedSkillId, state.skills) ?? 'unclassified'
    skillXpById.set(finalSkillId, (skillXpById.get(finalSkillId) ?? 0) + completion.skillXpAwarded)
  }

  const topSkillSummaries = Array.from(skillXpById.entries())
    .map(([skillId, currentXp]) => {
      const skill = state.skills.find((entry) => entry.id === skillId)
      return {
        skillId,
        skillName: skill?.name ?? '未分類',
        currentXp,
      }
    })
    .sort((left, right) => {
      if (right.currentXp !== left.currentXp) {
        return right.currentXp - left.currentXp
      }
      return left.skillName.localeCompare(right.skillName, 'ja')
    })
    .slice(0, 5)

  return {
    weekKey,
    previousWeekKey,
    weekLabel,
    startDate,
    endDate,
    totalCompletionCount: currentWeekCompletions.length,
    totalUserXp: currentWeekCompletions.reduce((sum, completion) => sum + completion.userXpAwarded, 0),
    activeDayCount: dailySummaries.filter((entry) => entry.completionCount > 0).length,
    topSkill: topSkillSummaries[0],
    dailySummaries,
    dailyQuestSummaries,
    topQuestSummaries,
    topSkillSummaries,
    hasData: currentWeekCompletions.length > 0,
  }
}

export function getWeeklyReflectionStatus(
  state: Pick<PersistedAppState, 'meta' | 'quests' | 'completions' | 'skills'>,
  referenceDate = new Date(),
): WeeklyReflectionStatus {
  const summary = getPreviousWeekReflectionSummary(state, referenceDate)
  return {
    weekKey: summary.weekKey,
    available: summary.hasData,
    unread: summary.hasData && state.meta.lastWeeklyReflectionWeek !== summary.weekKey,
  }
}

export function getQuestIdsWithActiveCompletions(completions: QuestCompletion[]) {
  return new Set(getActiveCompletions(completions).map((completion) => completion.questId))
}

export function isDailyQuest(quest: Quest) {
  return quest.questType === 'repeatable' && quest.isDaily === true
}

export function getQuestTypeLabel(quest: Quest) {
  if (quest.questType === 'one_time') {
    return '単発'
  }

  return isDailyQuest(quest) ? 'デイリー' : '繰り返し'
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

export function getRecommendedQuests(
  quests: Quest[],
  completions: QuestCompletion[],
  limit = 5,
) {
  return [...quests]
    .filter((quest) => quest.status !== 'archived' && quest.source !== 'browsing')
    .sort((left, right) => {
      const leftAvailability = getQuestAvailability(left, completions)
      const rightAvailability = getQuestAvailability(right, completions)
      const leftScore =
        (left.pinned ? 100 : 0) + (leftAvailability.canComplete ? 20 : 0) + left.xpReward
      const rightScore =
        (right.pinned ? 100 : 0) + (rightAvailability.canComplete ? 20 : 0) + right.xpReward
      return rightScore - leftScore
    })
    .slice(0, limit)
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

  const recommendedQuests = getRecommendedQuests(state.quests, state.completions)

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

function getSkillGainMapForRange(
  state: PersistedAppState,
  start: Date,
  end: Date,
) {
  const gainMap = new Map<string, number>()

  for (const completion of getActiveCompletions(state.completions)) {
    if (!completion.skillXpAwarded || !isWithinRange(completion.completedAt, start, end)) {
      continue
    }

    const resolvedSkillId = resolveMergedSkillId(completion.resolvedSkillId, state.skills)
    if (!resolvedSkillId) {
      continue
    }

    gainMap.set(resolvedSkillId, (gainMap.get(resolvedSkillId) ?? 0) + completion.skillXpAwarded)
  }

  return gainMap
}

function getRepresentativeSkill(
  skills: Skill[],
  recentGainMap: Map<string, number>,
) {
  return [...skills].sort((left, right) => {
    if (left.totalXp !== right.totalXp) {
      return right.totalXp - left.totalXp
    }

    const leftRecent = recentGainMap.get(left.id) ?? 0
    const rightRecent = recentGainMap.get(right.id) ?? 0
    if (leftRecent !== rightRecent) {
      return rightRecent - leftRecent
    }

    return left.name.localeCompare(right.name, 'ja')
  })[0]
}

function calculateWeekActionDays(state: PersistedAppState, referenceDate: Date) {
  const { start, end } = getWeekDateRange(referenceDate)
  const questMap = new Map(state.quests.map((quest) => [quest.id, quest]))
  const dayKeys = new Set(
    getActiveCompletions(state.completions)
      .filter((completion) => isWithinRange(completion.completedAt, start, end))
      .filter((completion) => questMap.get(completion.questId)?.source !== 'browsing')
      .map((completion) => getDayKey(completion.completedAt)),
  )

  return dayKeys.size
}

export function getStatusView(
  state: PersistedAppState,
  referenceDate = new Date(),
): StatusView {
  const activeSkills = state.skills.filter((skill) => skill.status === 'active')
  const recent7Start = startOfDay(subDays(referenceDate, 6))
  const recent7End = endOfDay(referenceDate)
  const recent30Start = startOfDay(subDays(referenceDate, 29))
  const recent30End = endOfDay(referenceDate)
  const recent7GainMap = getSkillGainMapForRange(state, recent7Start, recent7End)
  const recent30GainMap = getSkillGainMapForRange(state, recent30Start, recent30End)

  const primaryCategories: StatusCategorySummary[] = STATUS_CATEGORY_CONFIG.map(({ category, label }) => {
    const categorySkills = activeSkills.filter((skill) => skill.category === category)
    const totalXp = categorySkills.reduce((sum, skill) => sum + skill.totalXp, 0)
    const recentXp = categorySkills.reduce((sum, skill) => sum + (recent7GainMap.get(skill.id) ?? 0), 0)
    const recent30dXp = categorySkills.reduce((sum, skill) => sum + (recent30GainMap.get(skill.id) ?? 0), 0)

    return {
      category,
      label,
      level: Math.floor(Math.max(0, totalXp) / SKILL_LEVEL_XP) + 1,
      totalXp,
      recentXp,
      recent30dXp,
      representativeSkill: getRepresentativeSkill(categorySkills, recent7GainMap),
    }
  })

  const typeRanking = [...primaryCategories].sort((left, right) => {
    if (left.recent30dXp !== right.recent30dXp) {
      return right.recent30dXp - left.recent30dXp
    }
    if (left.totalXp !== right.totalXp) {
      return right.totalXp - left.totalXp
    }
    return (STATUS_CATEGORY_ORDER.get(left.category) ?? 0) - (STATUS_CATEGORY_ORDER.get(right.category) ?? 0)
  })

  const currentType =
    (typeRanking[0]?.recent30dXp ?? 0) > 0
      ? {
          label:
            (typeRanking[1]?.recent30dXp ?? 0) > 0
              ? `${typeRanking[0]!.label} × ${typeRanking[1]!.label}型`
              : `${typeRanking[0]!.label}型`,
        }
      : {
          placeholder: '最近の記録が増えると表示されます',
        }

  const topGrowthCategories: StatusGrowthSummary[] = primaryCategories
    .filter((entry) => entry.recentXp > 0)
    .sort((left, right) => {
      if (left.recentXp !== right.recentXp) {
        return right.recentXp - left.recentXp
      }
      if (left.totalXp !== right.totalXp) {
        return right.totalXp - left.totalXp
      }
      return (STATUS_CATEGORY_ORDER.get(left.category) ?? 0) - (STATUS_CATEGORY_ORDER.get(right.category) ?? 0)
    })
    .slice(0, 3)
    .map((entry) => ({
      category: entry.category,
      label: entry.label,
      recentXp: entry.recentXp,
      representativeSkill: entry.representativeSkill,
    }))

  const otherSkills = activeSkills
    .filter((skill) => !STATUS_CATEGORY_LABELS.has(skill.category) && skill.totalXp > 0)
    .sort((left, right) => {
      if (left.totalXp !== right.totalXp) {
        return right.totalXp - left.totalXp
      }
      return left.name.localeCompare(right.name, 'ja')
    })

  const latestMessage = [...state.assistantMessages].sort((left, right) =>
    compareDates(left.createdAt, right.createdAt),
  )[0]
  const levelInfo = getLevelFromXp(state.user.totalXp, USER_LEVEL_XP)
  const activeCompletions = getActiveCompletions(state.completions)
  const latestCompletionAt = [...activeCompletions].sort((left, right) =>
    compareDates(left.completedAt, right.completedAt),
  )[0]?.completedAt

  return {
    userLevel: levelInfo.level,
    totalXp: levelInfo.totalXp,
    nextLevelXp: levelInfo.nextStepXp,
    levelProgress: levelInfo.progress,
    streakDays: calculateStreakDays(state.completions),
    latestMessage,
    currentType,
    primaryCategories,
    topGrowthCategories,
    otherCategory:
      otherSkills.length > 0
        ? {
            totalXp: otherSkills.reduce((sum, skill) => sum + skill.totalXp, 0),
            skills: otherSkills,
          }
        : undefined,
    condition: {
      todayCompletionCount: getTodayActiveCompletions(state.completions, referenceDate).length,
      todayUserXp: getTodayActiveCompletions(state.completions, referenceDate).reduce(
        (sum, completion) => sum + completion.userXpAwarded,
        0,
      ),
      weekActionDays: calculateWeekActionDays(state, referenceDate),
      latestCompletionAt,
    },
    recommendedQuests: getRecommendedQuests(state.quests, state.completions, 3),
  }
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
    isDaily: undefined,
    xpReward: 5,
    category: '学習',
    skillMappingMode: 'ai_auto',
    cooldownMinutes: DEFAULT_REPEATABLE_COOLDOWN,
    dailyCompletionCap: DEFAULT_REPEATABLE_DAILY_CAP,
    status: 'active',
    privacyMode: 'normal',
    pinned: false,
    source: 'manual',
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
      scrapArticles: imported.scrapArticles ?? [],
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
    scrapArticles: mergeRecordArrays(current.scrapArticles, imported.scrapArticles ?? []),
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

  if (
    PERIODIC_WEEKLY_REFLECTION_MESSAGES_ENABLED &&
    state.completions.length > 0 &&
    state.meta.lastWeeklyReflectionWeek !== weekKey
  ) {
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
