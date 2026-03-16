import { APP_SCHEMA_VERSION, GEMINI_MODELS, OPENAI_MODELS } from '@/domain/constants'
import type {
  AiConfig,
  AppMeta,
  AssistantMessage,
  LocalUser,
  PersistedAppState,
  ProviderConfig,
  Skill,
  UserSettings,
} from '@/domain/types'
import { nowIso } from '@/lib/date'
import { createId, slugify } from '@/lib/utils'

function createProviderConfig(provider: 'openai' | 'gemini'): ProviderConfig {
  const now = nowIso()
  if (provider === 'openai') {
    return {
      updatedAt: now,
      model: OPENAI_MODELS.text,
      ttsModel: OPENAI_MODELS.tts,
      voice: 'alloy',
      status: 'unverified',
    }
  }

  return {
    updatedAt: now,
    model: GEMINI_MODELS.text,
    ttsModel: GEMINI_MODELS.tts,
    voice: 'Kore',
    status: 'unverified',
  }
}

export function createDefaultUser(): LocalUser {
  const now = nowIso()
  return {
    id: 'local_user',
    level: 1,
    totalXp: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export function createDefaultSettings(): UserSettings {
  const now = nowIso()
  return {
    lilyVoiceEnabled: true,
    lilyAutoPlay: 'tap_only',
    defaultPrivacyMode: 'normal',
    aiEnabled: true,
    voiceCharacter: 'リリィ',
    notificationsEnabled: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function createDefaultAiConfig(): AiConfig {
  return {
    activeProvider: 'openai',
    providers: {
      openai: createProviderConfig('openai'),
      gemini: createProviderConfig('gemini'),
    },
  }
}

export function createDefaultMeta(): AppMeta {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    seededSampleData: false,
    notificationPermission:
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  }
}

export function createSeedSkill(name: string, category: string): Skill {
  const now = nowIso()
  return {
    id: `skill_${slugify(name) || createId('skill')}`,
    name,
    normalizedName: name.trim().toLowerCase(),
    category,
    level: 1,
    totalXp: 0,
    source: 'seed',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export function createWelcomeMessage(): AssistantMessage {
  return {
    id: createId('msg'),
    triggerType: 'nudge',
    mood: 'bright',
    text: '最初のクエストを作って、今日の成長を始めましょう。',
    createdAt: nowIso(),
  }
}

export function createEmptyState(): PersistedAppState {
  return {
    user: createDefaultUser(),
    settings: createDefaultSettings(),
    aiConfig: createDefaultAiConfig(),
    quests: [],
    completions: [],
    skills: [],
    personalSkillDictionary: [],
    assistantMessages: [createWelcomeMessage()],
    meta: createDefaultMeta(),
  }
}
