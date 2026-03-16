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

export const QUEST_CATEGORIES = [
  '学習',
  '健康',
  '仕事',
  '生活',
  '対人',
  '創作',
  'その他',
] as const

export const OPENAI_MODELS = {
  text: 'gpt-5-mini',
  tts: 'gpt-4o-mini-tts',
}

export const GEMINI_MODELS = {
  text: 'gemini-2.5-flash',
  tts: 'gemini-2.5-flash-preview-tts',
}

export const OPENAI_VOICES = ['alloy', 'verse', 'sage'] as const
export const GEMINI_VOICES = ['Kore', 'Aoede', 'Charon'] as const

export const SEED_SKILLS = [
  { category: '学習', names: ['読書', '調査', '英語', '記述'] },
  { category: '健康', names: ['運動', '睡眠', '食事管理'] },
  { category: '仕事', names: ['資料作成', '企画', '実装', 'タスク管理'] },
  { category: '生活', names: ['家事', '整理整頓', '金銭管理'] },
  { category: '対人', names: ['発信', '会話', '傾聴'] },
  { category: '創作', names: ['執筆', 'デザイン', '音楽'] },
] as const

export const SAMPLE_QUESTS = [
  {
    title: '読書する',
    description: '技術書を10分読む',
    xpReward: 5,
    category: '学習',
    questType: 'repeatable',
    skillMappingMode: 'fixed',
    skillName: '読書',
  },
  {
    title: '腕立て伏せをする',
    description: '20回 × 2セット',
    xpReward: 8,
    category: '健康',
    questType: 'repeatable',
    skillMappingMode: 'fixed',
    skillName: '運動',
  },
  {
    title: '企画資料を作る',
    description: '導入2ページを作成',
    xpReward: 20,
    category: '仕事',
    questType: 'one_time',
    skillMappingMode: 'ai_auto',
    skillName: '資料作成',
  },
] as const
