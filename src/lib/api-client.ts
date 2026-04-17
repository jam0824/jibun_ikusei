import type {
  AiConfig,
  AppMeta,
  AssistantMessage,
  ChatMessage,
  ChatSession,
  LocalUser,
  PersonalSkillDictionary,
  Quest,
  QuestCompletion,
  Skill,
  UserSettings,
} from '@/domain/types'
import type {
  ActivitySession,
  ActionLogDeletionRequest,
  DailyActivityLog,
  Device,
  OpenLoop,
  PrivacyRule,
  RawEvent,
  WeeklyActivityReview,
} from '@/domain/action-log-types'
import { getIdToken } from '@/lib/auth'

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string

export class ApiError extends Error {
  status: number
  path: string
  body?: unknown

  constructor(path: string, status: number, body?: unknown) {
    super(`API error: ${status} ${path}`)
    this.name = 'ApiError'
    this.status = status
    this.path = path
    this.body = body
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getIdToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...options,
  })
  const raw = await res.text()
  const body = raw
    ? (() => {
        try {
          return JSON.parse(raw)
        } catch {
          return raw
        }
      })()
    : undefined
  if (!res.ok) {
    throw new ApiError(path, res.status, body)
  }
  return body as T
}

// ユーザー
export function getUser() {
  return request<LocalUser | null>('/user')
}

export function putUser(user: Partial<LocalUser>) {
  return request<{ updated: boolean }>('/user', {
    method: 'PUT',
    body: JSON.stringify(user),
  })
}

// クエスト
export function getQuests() {
  return request<Quest[]>('/quests')
}

export function postQuest(quest: Quest) {
  return request<Quest>('/quests', {
    method: 'POST',
    body: JSON.stringify(quest),
  })
}

export function putQuest(id: string, quest: Partial<Quest>) {
  return request<Quest>(`/quests/${id}`, {
    method: 'PUT',
    body: JSON.stringify(quest),
  })
}

export function deleteQuest(id: string) {
  return request<{ deleted: string }>(`/quests/${id}`, {
    method: 'DELETE',
  })
}

// 完了記録
export function getCompletions() {
  return request<QuestCompletion[]>('/completions')
}

export function postCompletion(completion: QuestCompletion) {
  return request<unknown>('/completions', {
    method: 'POST',
    body: JSON.stringify(completion),
  })
}

export function putCompletion(id: string, updates: Partial<QuestCompletion>) {
  return request<unknown>(`/completions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

// スキル
export function getSkills() {
  return request<Skill[]>('/skills')
}

export function postSkill(skill: Skill) {
  return request<Skill>('/skills', {
    method: 'POST',
    body: JSON.stringify(skill),
  })
}

export function putSkill(id: string, skill: Partial<Skill>) {
  return request<Skill>(`/skills/${id}`, {
    method: 'PUT',
    body: JSON.stringify(skill),
  })
}

// 設定
export function getSettings() {
  return request<UserSettings | null>('/settings')
}

export function putSettings(settings: Partial<UserSettings>) {
  return request<{ updated: boolean }>('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

// AI設定
export function getAiConfig() {
  return request<AiConfig | null>('/ai-config')
}

export function putAiConfig(config: Partial<AiConfig>) {
  return request<{ updated: boolean }>('/ai-config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

// メタ
export function getMeta() {
  return request<AppMeta | null>('/meta')
}

export function putMeta(meta: AppMeta) {
  return request<{ updated: boolean }>('/meta', {
    method: 'PUT',
    body: JSON.stringify(meta),
  })
}

// メッセージ
export function getMessages() {
  return request<AssistantMessage[]>('/messages')
}

export function postMessage(message: AssistantMessage) {
  return request<AssistantMessage>('/messages', {
    method: 'POST',
    body: JSON.stringify(message),
  })
}

// ブラウジング時間
export interface BrowsingTimeData {
  date: string
  domains: Record<string, { totalSeconds: number; category: string; isGrowth: boolean }>
  totalSeconds: number
}

export function getBrowsingTimes(from: string, to: string) {
  return request<BrowsingTimeData[]>(`/browsing-times?from=${from}&to=${to}`)
}

export interface HealthDataEntry {
  date: string
  time: string
  weight_kg: number | null
  body_fat_pct: number | null
  source?: string
}

export function getHealthData(from: string, to: string) {
  return request<HealthDataEntry[]>(`/health-data?from=${from}&to=${to}`)
}

export function postHealthData(entries: HealthDataEntry[]) {
  return request<{ synced: number }>('/health-data', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  })
}

// アクティビティログ
export function postActivityLogs(entries: Array<{
  timestamp: string
  source: string
  action: string
  category: string
  details: Record<string, unknown>
}>) {
  return request<{ logged: number }>('/activity-logs', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  })
}

// 辞書
export function getDictionary() {
  return request<PersonalSkillDictionary[]>('/dictionary')
}

export function postDictEntry(entry: PersonalSkillDictionary) {
  return request<PersonalSkillDictionary>('/dictionary', {
    method: 'POST',
    body: JSON.stringify(entry),
  })
}

export function putDictEntry(id: string, entry: Partial<PersonalSkillDictionary>) {
  return request<PersonalSkillDictionary>(`/dictionary/${id}`, {
    method: 'PUT',
    body: JSON.stringify(entry),
  })
}

// チャットセッション
export function getChatSessions() {
  return request<ChatSession[]>('/chat-sessions')
}

export function postChatSession(session: ChatSession) {
  return request<ChatSession>('/chat-sessions', {
    method: 'POST',
    body: JSON.stringify(session),
  })
}

export function putChatSession(id: string, updates: Partial<ChatSession>) {
  return request<ChatSession>(`/chat-sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export function deleteChatSession(id: string) {
  return request<{ deleted: string }>(`/chat-sessions/${id}`, {
    method: 'DELETE',
  })
}

// チャットメッセージ
export function getChatMessages(sessionId: string) {
  return request<ChatMessage[]>(`/chat-sessions/${sessionId}/messages`)
}

export function getChatMessagesRange(from: string, to: string) {
  return request<ChatMessage[]>(`/chat-messages?from=${from}&to=${to}`)
}

export function postChatMessage(sessionId: string, message: ChatMessage) {
  return request<ChatMessage>(`/chat-sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify(message),
  })
}

// アクティビティログ取得
export interface ActivityLogEntry {
  timestamp: string
  source: string
  action: string
  category: string
  details: Record<string, unknown>
}

export function getActivityLogs(from: string, to: string) {
  return request<ActivityLogEntry[]>(`/activity-logs?from=${from}&to=${to}`)
}

export function postActionLogRawEvents(input: { deviceId: string; events: RawEvent[] }) {
  return request<{ logged: number }>('/action-log/raw-events', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getActionLogRawEvents(from: string, to: string) {
  return request<RawEvent[]>(`/action-log/raw-events?from=${from}&to=${to}`)
}

export function putActionLogSessions(input: { deviceId: string; sessions: ActivitySession[] }) {
  return request<{ updated: number }>('/action-log/sessions', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function putActionLogSessionHidden(
  id: string,
  input: { dateKey: string; hidden: boolean },
) {
  return request<ActivitySession>(`/action-log/sessions/${id}/hidden`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function getActionLogSessions(from: string, to: string) {
  return request<ActivitySession[]>(`/action-log/sessions?from=${from}&to=${to}`)
}

export function getActionLogDailyActivityLogs(from: string, to: string) {
  return request<DailyActivityLog[]>(`/action-log/daily?from=${from}&to=${to}`)
}

export function getActionLogDailyActivityLog(dateKey: string) {
  return request<DailyActivityLog | null>(`/action-log/daily/${dateKey}`)
}

export function putActionLogDailyActivityLog(log: DailyActivityLog) {
  return request<DailyActivityLog>(`/action-log/daily/${log.dateKey}`, {
    method: 'PUT',
    body: JSON.stringify(log),
  })
}

export function getActionLogWeeklyActivityReview(weekKey: string) {
  return request<WeeklyActivityReview | null>(`/action-log/weekly/${weekKey}`)
}

export function getActionLogWeeklyActivityReviews(year: number) {
  return request<WeeklyActivityReview[]>(`/action-log/weekly?year=${year}`)
}

export function putActionLogWeeklyActivityReview(review: WeeklyActivityReview) {
  return request<WeeklyActivityReview>(`/action-log/weekly/${review.weekKey}`, {
    method: 'PUT',
    body: JSON.stringify(review),
  })
}

export function getActionLogDevices() {
  return request<Device[]>('/action-log/devices')
}

export function putActionLogDevice(id: string, updates: Partial<Device>) {
  return request<Device>(`/action-log/devices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export function getActionLogPrivacyRules() {
  return request<PrivacyRule[]>('/action-log/privacy-rules')
}

export function putActionLogPrivacyRules(rules: PrivacyRule[]) {
  return request<{ updated: number }>('/action-log/privacy-rules', {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  })
}

export function getActionLogOpenLoops(from: string, to: string) {
  return request<OpenLoop[]>(`/action-log/open-loops?from=${from}&to=${to}`)
}

export function putActionLogOpenLoops(input: { dateKeys: string[]; openLoops: OpenLoop[] }) {
  return request<{ updated: number }>('/action-log/open-loops', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function deleteActionLogRange(from: string, to: string) {
  return request<{
    deleted: {
      rawEvents: number
      sessions: number
      dailyLogs: number
      weeklyReviews: number
      openLoops: number
    }
    deletionRequestId: string
  }>(`/action-log/range?from=${from}&to=${to}`, {
    method: 'DELETE',
  })
}

export function getActionLogDeletionRequests() {
  return request<ActionLogDeletionRequest[]>('/action-log/deletion-requests')
}

export function postActionLogDeletionRequestAck(id: string) {
  return request<{ acked: string }>(`/action-log/deletion-requests/${id}/ack`, {
    method: 'POST',
  })
}

// ---- 状況ログ ----

export type SituationLogEntry = {
  summary: string
  timestamp: string
  details: {
    camera_summaries?: string[]
    desktop_summaries?: string[]
    active_apps?: string[]
  }
}

export function getSituationLogs(from: string, to: string) {
  return request<SituationLogEntry[]>(`/situation-logs?from=${from}&to=${to}`)
}

// ---- 栄養素 ----

import type { MealType, NutritionRecord } from '@/domain/types'

export type NutritionDayResult = Record<MealType, NutritionRecord | null>

export function getNutrition(date: string) {
  return request<NutritionDayResult>(`/nutrition?date=${date}`)
}

export type NutritionRangeResult = Record<string, NutritionDayResult>

export function getNutritionRange(from: string, to: string) {
  return request<NutritionRangeResult>(`/nutrition?from=${from}&to=${to}`)
}

export function putNutrition(date: string, mealType: MealType, record: Omit<NutritionRecord, 'userId'>) {
  return request<NutritionRecord>(`/nutrition/${date}/${mealType}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  })
}

// ---- Fitbit ----

export interface FitbitHeartZone {
  name: string
  min: number
  max: number
  minutes: number
  calories_out: number
}

export interface FitbitSummary {
  date: string
  heart: {
    resting_heart_rate: number | null
    intraday_points: number
    heart_zones: FitbitHeartZone[]
  } | null
  active_zone_minutes: {
    intraday_points: number
    minutes_total_estimate: number | null
    summary_rows: number
  } | null
  sleep: {
    main_sleep: {
      date_of_sleep: string
      start_time: string
      end_time: string
      minutes_asleep: number
      minutes_awake: number
      time_in_bed: number
      deep_minutes: number | null
      light_minutes: number | null
      rem_minutes: number | null
      wake_minutes: number | null
    } | null
    all_sleep_count: number
  } | null
  activity: {
    steps: number | null
    distance: number | null
    calories: number | null
    very_active_minutes: number | null
    fairly_active_minutes: number | null
    lightly_active_minutes: number | null
    sedentary_minutes: number | null
  } | null
}

export function getFitbitData(from: string, to: string) {
  return request<FitbitSummary[]>(`/fitbit-data?from=${from}&to=${to}`)
}
