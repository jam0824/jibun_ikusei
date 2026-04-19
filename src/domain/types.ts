export type QuestSource = 'manual' | 'browsing' | 'seed' | 'system'
export type BrowsingQuestType = 'good' | 'bad'
export type QuestType = 'repeatable' | 'one_time'
export type SkillMappingMode = 'fixed' | 'ai_auto' | 'ask_each_time'
export type PrivacyMode = 'normal' | 'no_ai'
export type QuestStatus = 'active' | 'completed' | 'archived'
export type SkillResolutionStatus =
  | 'not_needed'
  | 'pending'
  | 'resolved'
  | 'needs_confirmation'
  | 'unclassified'
export type AiProvider = 'openai' | 'gemini' | 'none'
export type ProviderStatus = 'unverified' | 'verified' | 'invalid'
export type SkillSource = 'manual' | 'ai' | 'seed'
export type SkillStatus = 'active' | 'merged'
export type TriggerType =
  | 'quest_completed'
  | 'user_level_up'
  | 'skill_level_up'
  | 'daily_summary'
  | 'weekly_reflection'
  | 'nudge'
export type MessageMood = 'bright' | 'calm' | 'playful' | 'epic'

export interface LocalUser {
  id: 'local_user'
  level: number
  totalXp: number
  createdAt: string
  updatedAt: string
}

export interface ProviderConfig {
  apiKey?: string
  status?: ProviderStatus
  updatedAt: string
  model: string
  ttsModel?: string
  voice?: string
}

export interface AiConfig {
  activeProvider: AiProvider
  providers: {
    openai: ProviderConfig
    gemini: ProviderConfig
  }
}

export interface UserSettings {
  lilyVoiceEnabled: boolean
  lilyAutoPlay: 'on' | 'tap_only' | 'off'
  defaultPrivacyMode: PrivacyMode
  reminderTime?: string
  aiEnabled: boolean
  voiceCharacter: string
  notificationsEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface Quest {
  id: string
  title: string
  description?: string
  questType: QuestType
  isDaily?: boolean
  xpReward: number
  category?: string
  skillMappingMode: SkillMappingMode
  fixedSkillId?: string
  defaultSkillId?: string
  cooldownMinutes?: number
  dailyCompletionCap?: number
  dueAt?: string
  reminderTime?: string
  status: QuestStatus
  privacyMode: PrivacyMode
  pinned: boolean
  source?: QuestSource
  systemKey?: 'meal_register'
  domain?: string
  browsingCategory?: string
  browsingType?: BrowsingQuestType
  createdAt: string
  updatedAt: string
}

export interface QuestCompletion {
  id: string
  questId: string
  clientRequestId: string
  completedAt: string
  note?: string
  userXpAwarded: number
  skillXpAwarded?: number
  resolvedSkillId?: string
  skillResolutionStatus: SkillResolutionStatus
  candidateSkillIds?: string[]
  resolutionReason?: string
  assistantMessageId?: string
  undoneAt?: string
  createdAt: string
}

export interface Skill {
  id: string
  name: string
  normalizedName: string
  category: string
  level: number
  totalXp: number
  source: SkillSource
  status: SkillStatus
  mergedIntoSkillId?: string
  createdAt: string
  updatedAt: string
}

export interface PersonalSkillDictionary {
  id: string
  phrase: string
  mappedSkillId: string
  createdBy: 'user_override' | 'system'
  createdAt: string
}

export interface AssistantMessage {
  id: string
  triggerType: TriggerType
  mood: MessageMood
  text: string
  audioUrl?: string
  completionId?: string
  periodKey?: string
  createdAt: string
}

export interface WeeklyReflectionCache {
  weekKey: string
  comment: string
  recommendations: string[]
  generatedAt: string
  provider: 'openai' | 'template'
}

export interface AppMeta {
  schemaVersion: number
  seededSampleData: boolean
  lastDailySummaryDate?: string
  lastWeeklyReflectionWeek?: string
  latestWeeklyReflection?: WeeklyReflectionCache
  lastNotificationCheckDate?: string
  notificationPermission?: 'default' | 'granted' | 'denied' | 'unsupported'
}

export interface PersistedAppState {
  user: LocalUser
  settings: UserSettings
  aiConfig: AiConfig
  quests: Quest[]
  completions: QuestCompletion[]
  skills: Skill[]
  personalSkillDictionary: PersonalSkillDictionary[]
  assistantMessages: AssistantMessage[]
  meta: AppMeta
}

export interface SkillResolutionResult {
  action: 'assign_existing' | 'assign_seed' | 'propose_new' | 'unclassified'
  skillName: string
  category: string
  confidence: number
  reason: string
  candidateSkills: string[]
}

export interface LilyMessageResult {
  intent: TriggerType
  mood: MessageMood
  text: string
  shouldSpeak: boolean
}

export interface QuestAvailability {
  canComplete: boolean
  state:
    | 'clearable'
    | 'cooling_down'
    | 'daily_cap_reached'
    | 'expired'
    | 'completed'
    | 'archived'
  label: string
  countToday: number
  nextAvailableAt?: string
}

export interface DashboardSkillGain {
  skill: Skill
  gain: number
}

export interface DashboardView {
  todayCompletionCount: number
  todayUserXp: number
  streakDays: number
  topSkillGains: DashboardSkillGain[]
  recommendedQuests: Quest[]
  latestMessage?: AssistantMessage
}

export interface StatusCategorySummary {
  category: string
  label: string
  level: number
  totalXp: number
  recentXp: number
  recent30dXp: number
  representativeSkill?: Skill
}

export interface StatusTypeSummary {
  label?: string
  placeholder?: string
}

export interface StatusGrowthSummary {
  category: string
  label: string
  recentXp: number
  representativeSkill?: Skill
}

export interface StatusConditionSummary {
  todayCompletionCount: number
  todayUserXp: number
  weekActionDays: number
  latestCompletionAt?: string
}

export interface StatusOtherCategorySummary {
  totalXp: number
  skills: Skill[]
}

export interface StatusView {
  userLevel: number
  totalXp: number
  nextLevelXp: number
  levelProgress: number
  streakDays: number
  latestMessage?: AssistantMessage
  currentType: StatusTypeSummary
  primaryCategories: StatusCategorySummary[]
  topGrowthCategories: StatusGrowthSummary[]
  otherCategory?: StatusOtherCategorySummary
  condition: StatusConditionSummary
  recommendedQuests: Quest[]
}

export type ChatMessageRole = 'user' | 'assistant' | 'system'

export interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: ChatMessageRole
  content: string
  createdAt: string
}

export interface ImportPayload {
  user?: LocalUser
  settings?: UserSettings
  aiConfig?: Partial<AiConfig>
  quests?: Quest[]
  completions?: QuestCompletion[]
  skills?: Skill[]
  personalSkillDictionary?: PersonalSkillDictionary[]
  assistantMessages?: AssistantMessage[]
  meta?: Partial<AppMeta>
}

// --- 食事・栄養素 ---

export type MealType = 'daily' | 'breakfast' | 'lunch' | 'dinner'
export type NutrientLabel = '不足' | '適正' | '過剰'
export type ThresholdType = 'range' | 'min_only' | 'max_only'

export interface NutrientThreshold {
  lower?: number
  upper?: number
  type: ThresholdType
}

export interface NutrientEntry {
  value: number | null
  unit: string
  label: NutrientLabel | null
  threshold: NutrientThreshold | null
}

export type NutrientKey =
  | 'energy'
  | 'protein'
  | 'fat'
  | 'carbs'
  | 'potassium'
  | 'calcium'
  | 'iron'
  | 'vitaminA'
  | 'vitaminE'
  | 'vitaminB1'
  | 'vitaminB2'
  | 'vitaminB6'
  | 'vitaminC'
  | 'fiber'
  | 'saturatedFat'
  | 'salt'

export type NutrientMap = Record<NutrientKey, NutrientEntry>

export interface NutritionRecord {
  userId: string
  date: string
  mealType: MealType
  nutrients: NutrientMap
  createdAt: string
  updatedAt: string
}
