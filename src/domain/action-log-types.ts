export const ACTION_LOG_SOURCES = [
  'desktop_agent',
  'chrome_extension',
  'calendar',
  'manual_note',
] as const

export type ActionLogSource = (typeof ACTION_LOG_SOURCES)[number]

export const RAW_EVENT_TYPES = [
  'active_window_changed',
  'browser_page_changed',
  'heartbeat',
  'file_context_changed',
  'calendar_context',
  'manual_note_created',
  'idle_started',
  'idle_ended',
  'desktop_context_summary_generated',
] as const

export type RawEventType = (typeof RAW_EVENT_TYPES)[number]

export const ACTIVITY_CATEGORIES = [
  '学習',
  '仕事',
  '健康',
  '生活',
  '創作',
  '対人',
  '娯楽',
  'その他',
] as const

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

export const DEVICE_PLATFORMS = ['windows', 'mac', 'linux', 'ios', 'android'] as const

export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number]

export const DEVICE_CAPTURE_STATES = ['active', 'paused', 'disabled'] as const

export type DeviceCaptureState = (typeof DEVICE_CAPTURE_STATES)[number]

export const OPEN_LOOP_STATUSES = ['open', 'closed', 'ignored'] as const

export type OpenLoopStatus = (typeof OPEN_LOOP_STATUSES)[number]

export const PRIVACY_RULE_TYPES = ['app', 'domain', 'window_title', 'storage_mode'] as const

export type PrivacyRuleType = (typeof PRIVACY_RULE_TYPES)[number]

export const PRIVACY_RULE_MODES = [
  'exclude',
  'full_url',
  'domain_only',
  'ai_summary_only',
  'ai_disabled',
] as const

export type PrivacyRuleMode = (typeof PRIVACY_RULE_MODES)[number]

export interface Device {
  id: string
  name: string
  platform: DevicePlatform
  captureState: DeviceCaptureState
  createdAt: string
  updatedAt: string
}

export interface RawEvent {
  id: string
  deviceId: string
  source: ActionLogSource
  eventType: RawEventType
  occurredAt: string
  appName?: string
  windowTitle?: string
  url?: string
  domain?: string
  projectName?: string
  fileName?: string
  metadata?: Record<string, unknown>
  expiresAt?: string
}

export interface ActivitySession {
  id: string
  deviceId: string
  startedAt: string
  endedAt: string
  dateKey: string
  title: string
  primaryCategory: ActivityCategory
  activityKinds: string[]
  appNames: string[]
  domains: string[]
  projectNames: string[]
  summary?: string
  searchKeywords: string[]
  noteIds: string[]
  openLoopIds: string[]
  hidden: boolean
}

export interface DailyActivityLog {
  id: string
  dateKey: string
  summary: string
  mainThemes: string[]
  noteIds: string[]
  openLoopIds: string[]
  reviewQuestions: string[]
  generatedAt: string
}

export interface WeeklyActivityReview {
  id: string
  weekKey: string
  summary: string
  categoryDurations: Record<string, number>
  focusThemes: string[]
  openLoopIds: string[]
  generatedAt: string
}

export interface ManualNote {
  id: string
  createdAt: string
  dateKey: string
  body: string
  linkedSessionId?: string
}

export interface OpenLoop {
  id: string
  createdAt: string
  updatedAt: string
  dateKey: string
  title: string
  description?: string
  status: OpenLoopStatus
  linkedSessionIds: string[]
}

export interface PrivacyRule {
  id: string
  type: PrivacyRuleType
  value: string
  mode: PrivacyRuleMode
  enabled: boolean
  updatedAt?: string
}
