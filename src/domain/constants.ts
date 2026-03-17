export const STORAGE_KEYS = {
  user: 'app.user',
  settings: 'app.settings',
  quests: 'app.quests',
  completions: 'app.completions',
  skills: 'app.skills',
  assistantMessages: 'app.assistantMessages',
  personalSkillDictionary: 'app.personalSkillDictionary',
  aiConfig: 'app.aiConfig',
  meta: 'app.meta',
} as const

export const APP_SCHEMA_VERSION = 1
export const USER_LEVEL_XP = 100
export const SKILL_LEVEL_XP = 50
export const SKILL_XP_CAP = 20
export const DEFAULT_REPEATABLE_COOLDOWN = 30
export const DEFAULT_REPEATABLE_DAILY_CAP = 1
export const MIN_REPEATABLE_COOLDOWN = 0
export const MAX_REPEATABLE_COOLDOWN = 1440
export const MIN_REPEATABLE_DAILY_CAP = 1
export const MAX_REPEATABLE_DAILY_CAP = 10

export const QUEST_CATEGORIES = [
  '学習',
  '運動',
  '仕事',
  '生活',
  '対人',
  '創作',
  'その他',
] as const

export const OPENAI_MODELS = {
  text: 'gpt-5.4',
} as const

export const GEMINI_MODELS = {
  text: 'gemini-2.5-flash',
  tts: 'gemini-2.5-flash-preview-tts',
} as const

export const GEMINI_VOICES = [
  'Zephyr',
  'Puck',
  'Kore',
  'Aoede',
  'Charon',
  'Callirrhoe',
  'Fenrir',
  'Leda',
  'Orus',
] as const

export const SEED_SKILLS = [
  { category: '学習', names: ['読書', '学習習慣', '情報整理', '調査'] },
  { category: '運動', names: ['有酸素運動', '筋力トレーニング', 'ストレッチ'] },
  { category: '仕事', names: ['文書作成', 'タスク管理', '集中作業', '企画設計'] },
  { category: '生活', names: ['家事', '健康管理', '睡眠習慣'] },
  { category: '対人', names: ['コミュニケーション', '傾聴', '気配り'] },
  { category: '創作', names: ['ライティング', 'デザイン', '発想力'] },
] as const

export const SAMPLE_QUESTS = [
  {
    title: '読書する',
    description: '気になっている本を10分読む',
    xpReward: 5,
    category: '学習',
    questType: 'repeatable',
    skillMappingMode: 'fixed',
    skillName: '読書',
  },
  {
    title: 'エアロバイクを漕ぐ',
    description: '20分の有酸素運動をする',
    xpReward: 8,
    category: '運動',
    questType: 'repeatable',
    skillMappingMode: 'fixed',
    skillName: '有酸素運動',
  },
  {
    title: '企画メモを2ページ書く',
    description: '集中してアイデアを言語化する',
    xpReward: 20,
    category: '仕事',
    questType: 'one_time',
    skillMappingMode: 'ai_auto',
    skillName: '文書作成',
  },
] as const
