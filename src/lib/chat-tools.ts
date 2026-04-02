import {
  getActivityLogs,
  getBrowsingTimes,
  getChatMessages,
  getHealthData,
  getSituationLogs,
} from '@/lib/api-client'
import type {
  ActivityLogEntry,
  SituationLogEntry,
} from '@/lib/api-client'
import { aggregateByCategory, aggregateDomains } from '@/lib/browsing-aggregator'
import { formatSeconds } from '@/lib/time-format'
import { maskApiKey } from '@/domain/logic'
import { createId } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import type {
  ChatMessage,
  ChatSession,
  PersistedAppState,
  Quest,
} from '@/domain/types'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const CHAT_MESSAGE_FETCH_CONCURRENCY = 4

type Period = 'today' | 'week' | 'month'
type ToolArgs = Record<string, unknown>
type DateFilterResult = ResolvedDateFilter | { error: string }
type OptionalDateFilterResult = ResolvedDateFilter | null | { error: string }

type ResolvedDateFilter = {
  from: string
  to: string
  fromIndex: number
  toIndex: number
  label: string
  kind: 'date' | 'range' | 'period'
}

type LoadedSessionMessages = {
  session: ChatSession
  messages: ChatMessage[]
}

export type ToolContext = {
  appState: PersistedAppState
  chatSessions: ChatSession[]
  chatMessages: ChatMessage[]
}

const PERIOD_LABELS: Record<Period, string> = {
  today: '今日',
  week: '直近7日',
  month: '直近30日',
}

const PERIOD_PROPERTY = {
  type: 'string',
  enum: ['today', 'week', 'month'],
  description: 'today=今日、week=直近7日、month=直近30日。明示日付がないときだけ使う。',
} as const

const JST_DATE_PROPERTIES = {
  date: {
    type: 'string',
    description: 'JSTの日付。YYYY-MM-DD 形式。',
  },
  fromDate: {
    type: 'string',
    description: 'JSTの開始日。YYYY-MM-DD 形式。',
  },
  toDate: {
    type: 'string',
    description: 'JSTの終了日。YYYY-MM-DD 形式。',
  },
} as const

function toJst(isoValue: string): string {
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) {
    return isoValue
  }

  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  return jst.toISOString().slice(0, 16).replace('T', ' ')
}

function isPeriod(value: unknown): value is Period {
  return value === 'today' || value === 'week' || value === 'month'
}

function getTextArg(args: ToolArgs, key: string): string | undefined {
  const value = args[key]
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseJstDate(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

function getJstDateKey(value: string | Date): string {
  if (typeof value === 'string' && parseJstDate(value)) {
    return value
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : ''
  }

  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  return jst.toISOString().slice(0, 10)
}

function getJstDayIndex(dateKey: string): number | null {
  const parsed = parseJstDate(dateKey)
  if (!parsed) {
    return null
  }

  return Math.floor(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / DAY_MS)
}

function formatJstDayIndex(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10)
}

function resolvePeriodFilter(period: Period): ResolvedDateFilter {
  const todayKey = getJstDateKey(new Date())
  const todayIndex = getJstDayIndex(todayKey)

  if (todayIndex === null) {
    throw new Error('Failed to resolve JST date')
  }

  const fromIndex =
    period === 'month' ? todayIndex - 30 : period === 'week' ? todayIndex - 6 : todayIndex

  return {
    from: formatJstDayIndex(fromIndex),
    to: todayKey,
    fromIndex,
    toIndex: todayIndex,
    label: PERIOD_LABELS[period],
    kind: 'period',
  }
}

function resolveOptionalJstDateFilter(args: ToolArgs): OptionalDateFilterResult {
  const date = getTextArg(args, 'date')
  const fromDate = getTextArg(args, 'fromDate')
  const toDate = getTextArg(args, 'toDate')

  if (date) {
    const dateIndex = getJstDayIndex(date)
    if (dateIndex === null) {
      return { error: 'date は YYYY-MM-DD 形式の JST 日付で指定してください。' }
    }

    return {
      from: date,
      to: date,
      fromIndex: dateIndex,
      toIndex: dateIndex,
      label: `${date} (JST)`,
      kind: 'date',
    }
  }

  if (fromDate || toDate) {
    if (!fromDate || !toDate) {
      return { error: 'fromDate と toDate はセットで指定してください。' }
    }

    const fromIndex = getJstDayIndex(fromDate)
    const toIndex = getJstDayIndex(toDate)
    if (fromIndex === null || toIndex === null) {
      return { error: 'fromDate / toDate は YYYY-MM-DD 形式の JST 日付で指定してください。' }
    }

    if (fromIndex > toIndex) {
      return { error: 'fromDate は toDate 以下にしてください。' }
    }

    return {
      from: fromDate,
      to: toDate,
      fromIndex,
      toIndex,
      label: `${fromDate}〜${toDate} (JST)`,
      kind: 'range',
    }
  }

  const period = args.period
  if (period === undefined || period === null || period === '') {
    return null
  }

  if (!isPeriod(period)) {
    return { error: 'period は today / week / month のいずれかで指定してください。' }
  }

  return resolvePeriodFilter(period)
}

function resolveJstDateFilter(args: ToolArgs, defaultPeriod: Period): DateFilterResult {
  const explicit = resolveOptionalJstDateFilter(args)
  if (explicit && 'error' in explicit) {
    return explicit
  }
  if (explicit) {
    return explicit
  }
  return resolvePeriodFilter(defaultPeriod)
}

function isInJstDateRange(timestamp: string, filter: ResolvedDateFilter): boolean {
  const dayIndex = getJstDayIndex(getJstDateKey(timestamp))
  return dayIndex !== null && dayIndex >= filter.fromIndex && dayIndex <= filter.toIndex
}

function sessionMayContainMessagesInRange(session: ChatSession, filter: ResolvedDateFilter): boolean {
  const createdIndex = getJstDayIndex(getJstDateKey(session.createdAt))
  const updatedIndex = getJstDayIndex(getJstDateKey(session.updatedAt))

  if (createdIndex === null || updatedIndex === null) {
    return true
  }

  return createdIndex <= filter.toIndex && updatedIndex >= filter.fromIndex
}

function buildContextMessagesBySession(messages: ChatMessage[]): Map<string, ChatMessage[]> {
  const grouped = new Map<string, ChatMessage[]>()
  for (const message of messages) {
    const existing = grouped.get(message.sessionId)
    if (existing) {
      existing.push(message)
    } else {
      grouped.set(message.sessionId, [message])
    }
  }
  return grouped
}

function isRetryableMessageFetchError(error: unknown): boolean {
  return error instanceof Error && /\b(502|503|504)\b/.test(error.message)
}

async function getChatMessagesWithRetry(sessionId: string): Promise<ChatMessage[]> {
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getChatMessages(sessionId)
    } catch (error) {
      lastError = error
      if (!isRetryableMessageFetchError(error) || attempt === 1) {
        break
      }
    }
  }

  throw lastError
}

function describeFilter(filter: ResolvedDateFilter | null, fallback = '全件'): string {
  return filter?.label ?? fallback
}

function sliceWithOverflow(items: string[], totalCount: number): string[] {
  if (totalCount > items.length) {
    return [...items, `  ...他${totalCount - items.length}件`]
  }
  return items
}

async function loadMessagesForSessions(
  sessions: ChatSession[],
  fallbackMessages: ChatMessage[] = [],
): Promise<{ loaded: LoadedSessionMessages[]; failedCount: number }> {
  if (sessions.length === 0) {
    return { loaded: [], failedCount: 0 }
  }

  const loaded: LoadedSessionMessages[] = []
  let failedCount = 0
  const fallbackBySession = buildContextMessagesBySession(fallbackMessages)

  for (let index = 0; index < sessions.length; index += CHAT_MESSAGE_FETCH_CONCURRENCY) {
    const chunk = sessions.slice(index, index + CHAT_MESSAGE_FETCH_CONCURRENCY)
    const settled = await Promise.allSettled(
      chunk.map(async (session) => ({
        session,
        messages: await getChatMessagesWithRetry(session.id),
      })),
    )

    settled.forEach((result, chunkIndex) => {
      const session = chunk[chunkIndex]
      if (result.status === 'fulfilled') {
        loaded.push(result.value)
        return
      }

      const fallback = fallbackBySession.get(session.id)
      if (fallback && fallback.length > 0) {
        loaded.push({ session, messages: fallback })
        return
      }

      failedCount += 1
    })
  }

  return { loaded, failedCount }
}

function getCandidateSessionsForDateFilter(
  sessions: ChatSession[],
  dateFilter: ResolvedDateFilter,
): ChatSession[] {
  return sessions.filter((session) => sessionMayContainMessagesInRange(session, dateFilter))
}

async function loadMessagesForCandidateSessions(
  sessions: ChatSession[],
  dateFilter: ResolvedDateFilter,
  context: ToolContext,
): Promise<{ candidates: ChatSession[]; loaded: LoadedSessionMessages[]; failedCount: number }> {
  const candidates = getCandidateSessionsForDateFilter(sessions, dateFilter)
  const { loaded, failedCount } = await loadMessagesForSessions(candidates, context.chatMessages)
  return { candidates, loaded, failedCount }
}

export const CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_browsing_times',
      description: 'ユーザーのWeb閲覧時間データを取得する。date / fromDate / toDate は JST の YYYY-MM-DD 形式。',
      parameters: {
        type: 'object',
        properties: {
          period: PERIOD_PROPERTY,
          ...JST_DATE_PROPERTIES,
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_user_info',
      description: 'ユーザーのプロフィール・設定・メタ情報を取得する。レベル、XP、設定状況などを確認したいときに使う。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['profile', 'settings', 'meta'],
            description: 'profile=レベル・XP等、settings=アプリ設定、meta=スキーマ・サマリー日時等',
          },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_health_data',
      description: 'ユーザーの体重・体脂肪率データを取得する。Health Planet（タニタ体組成計）から同期したデータ。date / fromDate / toDate は JST の YYYY-MM-DD 形式。',
      parameters: {
        type: 'object',
        properties: {
          period: PERIOD_PROPERTY,
          ...JST_DATE_PROPERTIES,
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_quest_data',
      description: 'クエスト一覧や完了記録を取得する。completions では date / fromDate / toDate を JST の YYYY-MM-DD 形式で指定できる。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['quests', 'completions'],
            description: 'quests=クエスト一覧、completions=クエスト完了記録',
          },
          status: {
            type: 'string',
            enum: ['active', 'completed', 'archived'],
            description: 'クエストのステータスフィルタ（type=questsの場合）',
          },
          questType: {
            type: 'string',
            enum: ['repeatable', 'one_time'],
            description: 'クエスト種別フィルタ（type=questsの場合）',
          },
          category: {
            type: 'string',
            description: 'カテゴリフィルタ（type=questsの場合）',
          },
          period: PERIOD_PROPERTY,
          ...JST_DATE_PROPERTIES,
          questId: {
            type: 'string',
            description: '特定クエストの完了記録のみ取得（type=completionsの場合）',
          },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_skill_data',
      description: 'スキル一覧や個人スキル辞書を取得する。スキルのレベル・XP・カテゴリを確認したいときに使う。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['skills', 'dictionary'],
            description: 'skills=スキル一覧、dictionary=個人スキル辞書',
          },
          status: {
            type: 'string',
            enum: ['active', 'merged'],
            description: 'スキルのステータスフィルタ（type=skillsの場合）',
          },
          category: {
            type: 'string',
            description: 'カテゴリフィルタ（type=skillsの場合）',
          },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_messages_and_logs',
      description: 'アシスタントメッセージ、AI設定、アクティビティログ、チャット履歴を取得する。明示日付は date / fromDate / toDate に JST の YYYY-MM-DD で指定する。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['assistant_messages', 'ai_config', 'activity_logs', 'situation_logs', 'chat_sessions', 'chat_messages'],
            description: 'assistant_messages=リリィの過去メッセージ、ai_config=AI設定、activity_logs=操作ログ、situation_logs=状況ログ（カメラ・デスクトップ状況の30分要約）、chat_sessions=チャットセッション一覧、chat_messages=特定セッションのメッセージ',
          },
          triggerType: {
            type: 'string',
            enum: ['quest_completed', 'user_level_up', 'skill_level_up', 'daily_summary', 'weekly_reflection', 'nudge'],
            description: 'メッセージのトリガー種別フィルタ（type=assistant_messagesの場合）',
          },
          period: {
            ...PERIOD_PROPERTY,
            description: '期間フィルタ。明示日付がないときだけ使う。',
          },
          ...JST_DATE_PROPERTIES,
          sessionId: {
            type: 'string',
            description: 'チャットセッションID（type=chat_messages で単一セッションを指定したい場合）',
          },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_quest',
      description: 'ユーザーの代わりにクエストを新規作成する。「〇〇するクエスト作って」「新しいクエストを追加して」などに対応。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'クエストのタイトル',
          },
          description: {
            type: 'string',
            description: 'クエストの説明（任意）',
          },
          questType: {
            type: 'string',
            enum: ['repeatable', 'one_time'],
            description: 'クエスト種別。repeatable=繰り返し（デフォルト）、one_time=一回限り',
          },
          xpReward: {
            type: 'number',
            description: '獲得XP（デフォルト: 10）',
          },
          category: {
            type: 'string',
            enum: ['学習', '運動', '仕事', '生活', '対人', '創作', 'その他'],
            description: 'カテゴリ（任意）',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'complete_quest',
      description: 'クエストをクリア（完了）する。「〇〇をクリアした」「トマトジュース飲んだ」など、タイトルが完全一致でなくても推定してクリアする。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'クエストを特定するための検索クエリ。タイトルの一部やキーワードでOK（例:「トマトジュース」「ランニング」）',
          },
          note: {
            type: 'string',
            description: '完了時のメモ（任意）',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_quest',
      description: 'クエストを削除またはアーカイブする。「〇〇のクエスト消して」「クエストをアーカイブして」などに対応。完了履歴があるクエストはアーカイブのみ可能。',
      parameters: {
        type: 'object',
        properties: {
          questId: {
            type: 'string',
            description: 'クエストID（get_quest_dataで取得可能）',
          },
          title: {
            type: 'string',
            description: 'クエストのタイトル（部分一致で検索。questIdが不明な場合に使用）',
          },
          mode: {
            type: 'string',
            enum: ['delete', 'archive'],
            description: 'delete=完全削除（デフォルト）、archive=アーカイブ（非表示にするが履歴は保持）',
          },
        },
      },
    },
  },
]

// ── 共通ユーティリティ ──

async function executeGetBrowsingTimes(args: ToolArgs): Promise<string> {
  const filter = resolveJstDateFilter(args, 'today')
  if ('error' in filter) {
    return filter.error
  }

  let entries
  try {
    entries = await getBrowsingTimes(filter.from, filter.to)
  } catch {
    return '閲覧時間データの取得に失敗しました。'
  }

  if (entries.length === 0) {
    return `${filter.label} の閲覧時間データがありません。`
  }

  const totalSeconds = entries.reduce((sum, entry) => sum + entry.totalSeconds, 0)
  const categories = aggregateByCategory(entries)
  const domains = aggregateDomains(entries, 10)

  const lines = [`【${filter.label} のブラウジング時間】`, `合計: ${formatSeconds(totalSeconds)}`, '']
  lines.push('■ カテゴリ別')
  for (const category of categories) {
    const growth = category.isGrowth ? '（成長系）' : ''
    lines.push(`- ${category.category}: ${formatSeconds(category.totalSeconds)}${growth}`)
  }
  lines.push('')
  lines.push('■ サイト別')
  for (const domain of domains) {
    lines.push(`- ${domain.domain}: ${formatSeconds(domain.totalSeconds)}（${domain.category}）`)
  }

  return lines.join('\n')
}

async function executeGetHealthData(args: ToolArgs): Promise<string> {
  const filter = resolveJstDateFilter(args, 'month')
  if ('error' in filter) {
    return filter.error
  }

  let records
  try {
    records = await getHealthData(filter.from, filter.to)
  } catch {
    return '体重・体脂肪率データの取得に失敗しました。'
  }

  if (records.length === 0) {
    return `${filter.label} の体重・体脂肪率データがありません。`
  }

  const lines = [`【${filter.label} の体重・体脂肪率】`, `取得件数: ${records.length}件`, '']
  for (const record of records) {
    const weight = record.weight_kg !== null ? `${record.weight_kg}kg` : '－'
    const bodyFat = record.body_fat_pct !== null ? `${record.body_fat_pct}%` : '－'
    lines.push(`- ${record.date} ${record.time}  体重: ${weight}  体脂肪率: ${bodyFat}`)
  }

  return lines.join('\n')
}

// ── get_user_info ──

function executeGetUserInfo(args: Record<string, unknown>, context: ToolContext): string {
  const type = args.type as string

  if (type === 'profile') {
    const { user } = context.appState
    return [
      '【ユーザープロフィール】',
      `- レベル: ${user.level}`,
      `- 総XP: ${user.totalXp}`,
      `- 作成日: ${user.createdAt.slice(0, 10)}`,
      `- 最終更新: ${user.updatedAt.slice(0, 10)}`,
    ].join('\n')
  }

  if (type === 'settings') {
    const s = context.appState.settings
    return [
      '【ユーザー設定】',
      `- リリィ音声: ${s.lilyVoiceEnabled ? 'ON' : 'OFF'}`,
      `- 自動再生: ${s.lilyAutoPlay}`,
      `- デフォルトプライバシー: ${s.defaultPrivacyMode}`,
      `- リマインダー: ${s.reminderTime ?? '未設定'}`,
      `- AI: ${s.aiEnabled ? 'ON' : 'OFF'}`,
      `- 声キャラ: ${s.voiceCharacter}`,
      `- 通知: ${s.notificationsEnabled ? 'ON' : 'OFF'}`,
    ].join('\n')
  }

  if (type === 'meta') {
    const m = context.appState.meta
    return [
      '【メタ情報】',
      `- スキーマバージョン: ${m.schemaVersion}`,
      `- サンプルデータ初期化済み: ${m.seededSampleData ? 'はい' : 'いいえ'}`,
      `- 最終日次サマリー: ${m.lastDailySummaryDate ?? '未実行'}`,
      `- 最終週次振り返り: ${m.lastWeeklyReflectionWeek ?? '未実行'}`,
      `- 通知権限: ${m.notificationPermission ?? '未確認'}`,
    ].join('\n')
  }

  return `不明なtype: ${type}`
}

// ── get_quest_data ──

function executeGetQuestData(args: ToolArgs, context: ToolContext): string {
  const type = args.type as string

  if (type === 'quests') {
    let quests = [...context.appState.quests]
    if (args.status) quests = quests.filter((q) => q.status === args.status)
    if (args.questType) quests = quests.filter((q) => q.questType === args.questType)
    if (args.category) quests = quests.filter((q) => q.category === args.category)

    if (quests.length === 0) return '該当するクエストがありません。'

    const lines: string[] = []
    lines.push(`【クエスト一覧】`)
    lines.push(`合計: ${quests.length}件`)
    lines.push('')

    for (const q of quests.slice(0, 20)) {
      const tags = [
        q.questType === 'repeatable' ? '繰り返し' : '一回限り',
        q.status,
        q.category ?? '',
        q.pinned ? '📌' : '',
      ].filter(Boolean).join(', ')
      lines.push(`- [${q.id}] ${q.title}（${tags}）XP: ${q.xpReward}`)
    }
    if (quests.length > 20) lines.push(`  ...他${quests.length - 20}件`)

    return lines.join('\n')
  }

  if (type === 'completions') {
    const dateFilter = resolveOptionalJstDateFilter(args)
    if (dateFilter && 'error' in dateFilter) {
      return dateFilter.error
    }

    const { completions, quests } = context.appState
    let filtered = completions.filter((c) => !c.undoneAt)

    if (args.questId) filtered = filtered.filter((c) => c.questId === args.questId)

    if (dateFilter) {
      filtered = filtered.filter((c) => isInJstDateRange(c.completedAt, dateFilter))
    }

    // Sort newest first
    filtered.sort((a, b) => b.completedAt.localeCompare(a.completedAt))

    if (filtered.length === 0) return '該当する完了記録がありません。'

    const lines: string[] = []
    lines.push(`【クエスト完了記録（${describeFilter(dateFilter)}）】`)
    lines.push(`合計: ${filtered.length}件`)
    lines.push('')

    for (const c of filtered.slice(0, 20)) {
      const questTitle = quests.find((q) => q.id === c.questId)?.title ?? '不明なクエスト'
      lines.push(`- ${questTitle} +${c.userXpAwarded} XP（${getJstDateKey(c.completedAt)}）`)
    }
    if (filtered.length > 20) lines.push(`  ...他${filtered.length - 20}件`)

    return lines.join('\n')
  }

  return `不明なtype: ${type}`
}

// ── get_skill_data ──

function executeGetSkillData(args: Record<string, unknown>, context: ToolContext): string {
  const type = args.type as string

  if (type === 'skills') {
    let skills = [...context.appState.skills]
    if (args.status) skills = skills.filter((s) => s.status === args.status)
    if (args.category) skills = skills.filter((s) => s.category === args.category)

    if (skills.length === 0) return '該当するスキルがありません。'

    // Sort by totalXp desc
    skills.sort((a, b) => b.totalXp - a.totalXp)

    const lines: string[] = []
    lines.push('【スキル一覧】')
    lines.push(`合計: ${skills.length}件`)
    lines.push('')

    for (const s of skills.slice(0, 20)) {
      const status = s.status === 'merged' ? `[統合済→${s.mergedIntoSkillId}]` : ''
      lines.push(`- ${s.name} Lv.${s.level}（${s.totalXp} XP, ${s.category}）${status}`)
    }
    if (skills.length > 20) lines.push(`  ...他${skills.length - 20}件`)

    return lines.join('\n')
  }

  if (type === 'dictionary') {
    const dict = context.appState.personalSkillDictionary
    const skills = context.appState.skills

    if (dict.length === 0) return '個人スキル辞書にエントリがありません。'

    const lines: string[] = []
    lines.push('【個人スキル辞書】')
    lines.push(`合計: ${dict.length}件`)
    lines.push('')

    for (const d of dict.slice(0, 20)) {
      const skillName = skills.find((s) => s.id === d.mappedSkillId)?.name ?? '不明'
      lines.push(`- 「${d.phrase}」→ ${skillName}（${d.createdBy}）`)
    }
    if (dict.length > 20) lines.push(`  ...他${dict.length - 20}件`)

    return lines.join('\n')
  }

  return `不明なtype: ${type}`
}

// ── get_messages_and_logs ──

async function executeGetMessagesAndLogs(args: ToolArgs, context: ToolContext): Promise<string> {
  const type = args.type as string

  if (type === 'assistant_messages') {
    const dateFilter = resolveOptionalJstDateFilter(args)
    if (dateFilter && 'error' in dateFilter) {
      return dateFilter.error
    }

    let messages = [...context.appState.assistantMessages]
    const triggerType = getTextArg(args, 'triggerType')
    if (triggerType) {
      messages = messages.filter((message) => message.triggerType === triggerType)
    }
    if (dateFilter) {
      messages = messages.filter((message) => isInJstDateRange(message.createdAt, dateFilter))
    }

    messages.sort((left, right) => right.createdAt.localeCompare(left.createdAt))

    if (messages.length === 0) return '該当するメッセージがありません。'

    const lines = [
      `【アシスタントメッセージ（${describeFilter(dateFilter)}）】`,
      `合計: ${messages.length}件`,
      '',
    ]
    const items = messages
      .slice(0, 20)
      .map((message) => `- [${message.triggerType}] ${message.text}（${getJstDateKey(message.createdAt)}）`)

    return [...lines, ...sliceWithOverflow(items, messages.length)].join('\n')
  }

  if (type === 'ai_config') {
    const cfg = context.appState.aiConfig
    const lines: string[] = []
    lines.push('【AI設定】')
    lines.push(`- アクティブプロバイダー: ${cfg.activeProvider}`)
    lines.push('')

    for (const [name, provider] of Object.entries(cfg.providers)) {
      lines.push(`■ ${name}`)
      lines.push(`  - APIキー: ${maskApiKey(provider.apiKey)}`)
      lines.push(`  - ステータス: ${provider.status ?? '未設定'}`)
      lines.push(`  - モデル: ${provider.model}`)
      if (provider.ttsModel) lines.push(`  - TTSモデル: ${provider.ttsModel}`)
      if (provider.voice) lines.push(`  - 声: ${provider.voice}`)
    }

    return lines.join('\n')
  }

  if (type === 'activity_logs') {
    const filter = resolveJstDateFilter(args, 'week')
    if ('error' in filter) {
      return filter.error
    }

    let logs: ActivityLogEntry[]
    try {
      logs = await getActivityLogs(filter.from, filter.to)
    } catch {
      return 'アクティビティログの取得に失敗しました。'
    }

    if (logs.length === 0) return `${filter.label} のアクティビティログがありません。`

    const lines = [`【アクティビティログ（${filter.label}）】`, `合計: ${logs.length}件`, '']
    const items = logs
      .slice(0, 20)
      .map((log) => `- [${log.category}] ${log.action}（${toJst(log.timestamp)}）`)

    return [...lines, ...sliceWithOverflow(items, logs.length)].join('\n')
  }

  if (type === 'situation_logs') {
    const filter = resolveJstDateFilter(args, 'week')
    if ('error' in filter) {
      return filter.error
    }

    let logs: SituationLogEntry[]
    try {
      logs = await getSituationLogs(filter.from, filter.to)
    } catch {
      return '状況ログの取得に失敗しました。'
    }

    if (logs.length === 0) return `${filter.label} の状況ログがありません。`

    const lines = [`【状況ログ（${filter.label}）】`, `合計: ${logs.length}件`, '']
    const items = logs.slice(0, 20).map((log) => {
      const apps = log.details.active_apps?.join(', ')
      const suffix = apps ? `（アプリ: ${apps}）` : ''
      return `- [${toJst(log.timestamp)}] ${log.summary}${suffix}`
    })

    return [...lines, ...sliceWithOverflow(items, logs.length)].join('\n')
  }

  if (type === 'chat_sessions') {
    const dateFilter = resolveOptionalJstDateFilter(args)
    if (dateFilter && 'error' in dateFilter) {
      return dateFilter.error
    }

    if (context.chatSessions.length === 0) return 'チャットセッションがありません。'

    if (!dateFilter) {
      const sessions = [...context.chatSessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      const lines = ['【チャットセッション一覧】', `合計: ${sessions.length}件`, '']
      const items = sessions
        .slice(0, 20)
        .map((session) => `- ${session.title}（${toJst(session.createdAt)}）ID: ${session.id}`)

      return [...lines, ...sliceWithOverflow(items, sessions.length)].join('\n')
    }

    const { candidates, loaded, failedCount } = await loadMessagesForCandidateSessions(
      context.chatSessions,
      dateFilter,
      context,
    )

    if (loaded.length === 0 && failedCount > 0) {
      return 'チャットセッションの取得に失敗しました。'
    }

    if (candidates.length === 0) {
      return `${dateFilter.label} に該当するチャットセッションがありません。`
    }

    const matched = loaded
      .map(({ session, messages }) => {
        const filteredMessages = messages.filter((message) => isInJstDateRange(message.createdAt, dateFilter))
        const latestAt = filteredMessages
          .map((message) => message.createdAt)
          .sort((left, right) => right.localeCompare(left))[0]

        return {
          session,
          count: filteredMessages.length,
          latestAt,
        }
      })
      .filter((entry) => entry.count > 0)
      .sort((left, right) => (right.latestAt ?? '').localeCompare(left.latestAt ?? ''))

    if (matched.length === 0) {
      return `${dateFilter.label} に該当するチャットセッションがありません。`
    }

    const lines = [`【チャットセッション一覧（${dateFilter.label}）】`, `合計: ${matched.length}件`, '']
    const items = matched
      .slice(0, 20)
      .map(
        (entry) =>
          `- ${entry.session.title}（${toJst(entry.session.createdAt)}）ID: ${entry.session.id} / 該当: ${entry.count}件`,
      )

    return [...lines, ...sliceWithOverflow(items, matched.length)].join('\n')
  }

  if (type === 'chat_messages') {
    const dateFilter = resolveOptionalJstDateFilter(args)
    if (dateFilter && 'error' in dateFilter) {
      return dateFilter.error
    }

    const sessionId = getTextArg(args, 'sessionId')

    if (sessionId) {
      let messages: ChatMessage[] = []
      try {
        messages = await getChatMessagesWithRetry(sessionId)
      } catch {
        messages = context.chatMessages.filter((message) => message.sessionId === sessionId)
      }

      if (dateFilter) {
        messages = messages.filter((message) => isInJstDateRange(message.createdAt, dateFilter))
      }

      messages.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      if (messages.length === 0) return '該当するメッセージがありません。'

      const sessionTitle = context.chatSessions.find((session) => session.id === sessionId)?.title ?? sessionId
      const lines = [
        `【チャットメッセージ（セッション: ${sessionTitle} / ${describeFilter(dateFilter)}）】`,
        `合計: ${messages.length}件`,
        '',
      ]
      const items = messages.slice(0, 30).map((message) => {
        const label = message.role === 'user' ? 'ユーザー' : 'リリー'
        return `- [${label}] ${message.content.slice(0, 100)}（${toJst(message.createdAt)}）`
      })

      return [...lines, ...sliceWithOverflow(items, messages.length)].join('\n')
    }

    if (!dateFilter) {
      return 'sessionId を指定するか、date / fromDate / toDate を指定してください。'
    }

    const { candidates, loaded, failedCount } = await loadMessagesForCandidateSessions(
      context.chatSessions,
      dateFilter,
      context,
    )

    if (loaded.length === 0 && failedCount > 0) {
      return 'チャットメッセージの取得に失敗しました。'
    }

    if (candidates.length === 0) {
      return `${dateFilter.label} に該当するチャットメッセージがありません。`
    }

    const messages = loaded
      .flatMap(({ session, messages }) =>
        messages.map((message) => ({
          message,
          session,
        })),
      )
      .filter(({ message }) => isInJstDateRange(message.createdAt, dateFilter))
      .sort((left, right) => right.message.createdAt.localeCompare(left.message.createdAt))

    if (messages.length === 0) {
      return `${dateFilter.label} に該当するチャットメッセージがありません。`
    }

    const lines = [`【チャットメッセージ（${dateFilter.label}）】`, `合計: ${messages.length}件`, '']
    const items = messages.slice(0, 30).map(({ message, session }) => {
      const label = message.role === 'user' ? 'ユーザー' : 'リリー'
      return `- [${session.title} / ${label}] ${message.content.slice(0, 100)}（${toJst(message.createdAt)}）`
    })

    return [...lines, ...sliceWithOverflow(items, messages.length)].join('\n')
  }

  return `不明なtype: ${type}`
}

// ── あいまいクエスト検索 ──

/**
 * クエリとタイトルのあいまいスコアを計算する (0〜1)。
 * - 完全一致 → 1
 * - タイトルがクエリを含む / クエリがタイトルを含む → 0.8
 * - クエリの全単語がタイトルに含まれる → 0.6
 * - 一部の単語が一致 → 単語一致率 * 0.5
 */
function fuzzyMatchScore(query: string, title: string): number {
  const q = query.toLowerCase().trim()
  const t = title.toLowerCase().trim()

  if (q === t) return 1
  if (t.includes(q) || q.includes(t)) return 0.8

  // 単語分割（日本語はそのまま文字単位、英語はスペース区切り）
  const qTokens = q.split(/[\s　、,・]+/).filter(Boolean)
  if (qTokens.length === 0) return 0

  const matchCount = qTokens.filter((token) => t.includes(token)).length
  if (matchCount === qTokens.length) return 0.6
  return (matchCount / qTokens.length) * 0.5
}

function findBestMatchQuest(query: string, quests: Quest[]): { quest: Quest; score: number } | null {
  const activeQuests = quests.filter((q) => q.status === 'active')
  if (activeQuests.length === 0) return null

  let best: { quest: Quest; score: number } | null = null
  for (const quest of activeQuests) {
    const score = fuzzyMatchScore(query, quest.title)
    if (score > 0 && (!best || score > best.score)) {
      best = { quest, score }
    }
  }
  return best
}

// ── complete_quest ──

async function executeCompleteQuest(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const query = args.query as string | undefined
  if (!query) return 'クエストを特定するための検索クエリを指定してください。'

  const match = findBestMatchQuest(query, context.appState.quests)
  if (!match || match.score < 0.2) {
    const activeQuests = context.appState.quests
      .filter((q) => q.status === 'active')
      .slice(0, 10)
      .map((q) => `「${q.title}」`)
      .join('、')
    return `「${query}」に該当するアクティブなクエストが見つかりません。\n現在のアクティブクエスト: ${activeQuests || 'なし'}`
  }

  const { quest } = match
  const note = (args.note as string) ?? undefined
  const now = new Date()
  const completedAt = now.toISOString()

  const result = await useAppStore.getState().completeQuest(quest.id, { completedAt, note, sourceScreen: 'home' })
  if (result.error) {
    return `クエスト「${quest.title}」のクリアに失敗しました: ${result.error}`
  }

  return `クエスト「${quest.title}」をクリアしました！ +${quest.xpReward} XP`
}

// ── create_quest ──

function executeCreateQuest(args: Record<string, unknown>): string {
  const title = args.title as string | undefined
  if (!title) return 'クエストのタイトルを指定してください。'

  const quest: Quest = {
    id: createId('quest'),
    title,
    description: (args.description as string) ?? undefined,
    questType: (args.questType as Quest['questType']) ?? 'repeatable',
    xpReward: (args.xpReward as number) ?? 10,
    category: (args.category as string) ?? undefined,
    skillMappingMode: 'ai_auto',
    privacyMode: 'normal',
    pinned: false,
    source: 'manual',
    status: 'active',
    createdAt: '',
    updatedAt: '',
  }

  useAppStore.getState().upsertQuest(quest)

  const tags = [
    quest.questType === 'repeatable' ? '繰り返し' : '一回限り',
    quest.category ?? '',
    `XP: ${quest.xpReward}`,
  ].filter(Boolean).join(', ')

  return `クエスト「${quest.title}」を作成しました。（${tags}）`
}

// ── delete_quest ──

function executeDeleteQuest(args: Record<string, unknown>, context: ToolContext): string {
  const questId = args.questId as string | undefined
  const title = args.title as string | undefined
  const mode = (args.mode as string) ?? 'delete'

  if (!questId && !title) return 'questIdまたはtitleを指定してください。'

  let targetQuest: ToolContext['appState']['quests'][number] | undefined

  if (questId) {
    targetQuest = context.appState.quests.find((q) => q.id === questId)
    if (!targetQuest) return `ID「${questId}」のクエストが見つかりません。`
  } else {
    const matches = context.appState.quests.filter((q) => q.title.includes(title!))
    if (matches.length === 0) return `「${title}」に該当するクエストが見つかりません。`
    if (matches.length > 1) {
      const names = matches.map((q) => `「${q.title}」`).join('、')
      return `「${title}」に複数のクエストが該当します: ${names}。questIdで指定してください。`
    }
    targetQuest = matches[0]
  }

  if (mode === 'archive') {
    useAppStore.getState().archiveQuest(targetQuest.id)
    return `クエスト「${targetQuest.title}」をアーカイブしました。`
  }

  const result = useAppStore.getState().deleteQuest(targetQuest.id)
  if (!result.ok) return result.reason!

  return `クエスト「${targetQuest.title}」を削除しました。`
}

// ── メインディスパッチ ──

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<string> {
  if (name === 'get_browsing_times') {
    return executeGetBrowsingTimes(args)
  }

  if (name === 'get_health_data') {
    return executeGetHealthData(args)
  }

  // context が必要なツール
  if (!context) {
    return 'データを取得できません（コンテキストがありません）。'
  }

  if (name === 'get_user_info') {
    return executeGetUserInfo(args, context)
  }

  if (name === 'get_quest_data') {
    return executeGetQuestData(args, context)
  }

  if (name === 'get_skill_data') {
    return executeGetSkillData(args, context)
  }

  if (name === 'get_messages_and_logs') {
    return executeGetMessagesAndLogs(args, context)
  }

  if (name === 'complete_quest') {
    return executeCompleteQuest(args, context)
  }

  if (name === 'create_quest') {
    return executeCreateQuest(args)
  }

  if (name === 'delete_quest') {
    return executeDeleteQuest(args, context)
  }

  return `不明なツール: ${name}`
}
