export type AiProvider = 'openai' | 'gemini'

export interface ExtensionSettings {
  aiProvider: AiProvider
  openaiApiKey?: string
  geminiApiKey?: string
  blocklist: string[]
  serverBaseUrl: string
  authToken?: string
  syncEnabled: boolean
  notificationsEnabled: boolean
}

export function createDefaultSettings(): ExtensionSettings {
  return {
    aiProvider: 'openai',
    blocklist: [],
    serverBaseUrl: '',
    syncEnabled: false,
    notificationsEnabled: true,
  }
}
