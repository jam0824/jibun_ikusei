import { getDayKey } from '@/lib/date'
import { subDays } from 'date-fns'
import { getBrowsingTimes, getActivityLogs } from '@/lib/api-client'
import type { ActivityLogEntry } from '@/lib/api-client'
import { aggregateDomains, aggregateByCategory } from '@/lib/browsing-aggregator'
import { formatSeconds } from '@/lib/time-format'
import { maskApiKey } from '@/domain/logic'
import type {
  PersistedAppState,
  ChatSession,
  ChatMessage,
} from '@/domain/types'

// ── ToolContext ──

export type ToolContext = {
  appState: PersistedAppState
  chatSessions: ChatSession[]
  chatMessages: ChatMessage[]
}

// ── ツール定義 ──

export const CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_browsing_times',
      description: 'ユーザーのWeb閲覧時間データを取得する。カテゴリ別・サイト別の内訳を確認できる。',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'week', 'month'],
            description: '取得する期間。today=今日、week=直近7日、month=直近30日',
          },
        },
        required: ['period'],
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
      name: 'get_quest_data',
      description: 'クエスト一覧やクエスト完了記録を取得する。「今日何をやった？」「アクティブなクエストは？」などに対応。',
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
          period: {
            type: 'string',
            enum: ['today', 'week', 'month'],
            description: '期間フィルタ（type=completionsの場合。未指定=直近7日）',
          },
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
      description: 'アシスタントメッセージ、AI設定、アクティビティログ、チャット履歴を取得する。過去の発言やログを確認したいときに使う。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['assistant_messages', 'ai_config', 'activity_logs', 'chat_sessions', 'chat_messages'],
            description: 'assistant_messages=リリィの過去メッセージ、ai_config=AI設定、activity_logs=操作ログ、chat_sessions=チャットセッション一覧、chat_messages=特定セッションのメッセージ',
          },
          triggerType: {
            type: 'string',
            enum: ['quest_completed', 'user_level_up', 'skill_level_up', 'daily_summary', 'weekly_reflection', 'nudge'],
            description: 'メッセージのトリガー種別フィルタ（type=assistant_messagesの場合）',
          },
          period: {
            type: 'string',
            enum: ['today', 'week', 'month'],
            description: '期間フィルタ（type=assistant_messages/activity_logsの場合。未指定=直近7日）',
          },
          sessionId: {
            type: 'string',
            description: 'チャットセッションID（type=chat_messagesの場合、必須）',
          },
        },
        required: ['type'],
      },
    },
  },
]

// ── 共通ユーティリティ ──

function getDateRange(period: string): { from: string; to: string } {
  const now = new Date()
  const to = getDayKey(now)

  if (period === 'week') {
    return { from: getDayKey(subDays(now, 6)), to }
  }

  if (period === 'month') {
    return { from: getDayKey(subDays(now, 30)), to }
  }

  // today
  return { from: to, to }
}

const PERIOD_LABELS: Record<string, string> = {
  today: '今日',
  week: '直近7日間',
  month: '直近30日間',
}

// ── get_browsing_times（既存） ──

async function executeGetBrowsingTimes(args: Record<string, unknown>): Promise<string> {
  const period = (args.period as string) ?? 'today'
  const { from, to } = getDateRange(period)

  let entries
  try {
    entries = await getBrowsingTimes(from, to)
  } catch {
    return '閲覧時間データの取得に失敗しました。'
  }

  if (entries.length === 0) {
    return `${PERIOD_LABELS[period] ?? period}の閲覧データがありません。`
  }

  const totalSeconds = entries.reduce((sum, e) => sum + e.totalSeconds, 0)
  const categories = aggregateByCategory(entries)
  const domains = aggregateDomains(entries, 10)

  const lines: string[] = []
  lines.push(`【${PERIOD_LABELS[period] ?? period}のブラウジング時間】`)
  lines.push(`合計: ${formatSeconds(totalSeconds)}`)
  lines.push('')

  lines.push('■ カテゴリ別')
  for (const cat of categories) {
    const growth = cat.isGrowth ? '（成長系）' : ''
    lines.push(`- ${cat.category}: ${formatSeconds(cat.totalSeconds)}${growth}`)
  }
  lines.push('')

  lines.push('■ サイト別')
  for (const d of domains) {
    lines.push(`- ${d.domain}: ${formatSeconds(d.totalSeconds)}（${d.category}）`)
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

function executeGetQuestData(args: Record<string, unknown>, context: ToolContext): string {
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
      lines.push(`- ${q.title}（${tags}）XP: ${q.xpReward}`)
    }
    if (quests.length > 20) lines.push(`  ...他${quests.length - 20}件`)

    return lines.join('\n')
  }

  if (type === 'completions') {
    const { completions, quests } = context.appState
    let filtered = completions.filter((c) => !c.undoneAt)

    if (args.questId) filtered = filtered.filter((c) => c.questId === args.questId)

    if (args.period) {
      const { from } = getDateRange(args.period as string)
      filtered = filtered.filter((c) => c.completedAt >= from)
    }

    // Sort newest first
    filtered.sort((a, b) => b.completedAt.localeCompare(a.completedAt))

    if (filtered.length === 0) return '該当する完了記録がありません。'

    const lines: string[] = []
    const periodLabel = args.period ? (PERIOD_LABELS[args.period as string] ?? '') : '全件'
    lines.push(`【クエスト完了記録（${periodLabel}）】`)
    lines.push(`合計: ${filtered.length}件`)
    lines.push('')

    for (const c of filtered.slice(0, 20)) {
      const questTitle = quests.find((q) => q.id === c.questId)?.title ?? '不明なクエスト'
      lines.push(`- ${questTitle} +${c.userXpAwarded} XP（${c.completedAt.slice(0, 10)}）`)
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

async function executeGetMessagesAndLogs(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const type = args.type as string

  if (type === 'assistant_messages') {
    let messages = [...context.appState.assistantMessages]

    if (args.triggerType) messages = messages.filter((m) => m.triggerType === args.triggerType)

    if (args.period) {
      const { from } = getDateRange(args.period as string)
      messages = messages.filter((m) => m.createdAt >= from)
    }

    // Sort newest first
    messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    if (messages.length === 0) return '該当するメッセージがありません。'

    const lines: string[] = []
    const periodLabel = args.period ? PERIOD_LABELS[args.period as string] ?? '' : '全件'
    lines.push(`【アシスタントメッセージ（${periodLabel}）】`)
    lines.push(`合計: ${messages.length}件`)
    lines.push('')

    for (const m of messages.slice(0, 20)) {
      lines.push(`- [${m.triggerType}] ${m.text}（${m.createdAt.slice(0, 10)}）`)
    }
    if (messages.length > 20) lines.push(`  ...他${messages.length - 20}件`)

    return lines.join('\n')
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
    const period = (args.period as string) ?? 'week'
    const { from, to } = getDateRange(period)

    let logs: ActivityLogEntry[]
    try {
      logs = await getActivityLogs(from, to)
    } catch {
      return 'アクティビティログの取得に失敗しました。'
    }

    if (logs.length === 0) return `${PERIOD_LABELS[period] ?? period}のアクティビティログがありません。`

    const lines: string[] = []
    lines.push(`【アクティビティログ（${PERIOD_LABELS[period] ?? period}）】`)
    lines.push(`合計: ${logs.length}件`)
    lines.push('')

    for (const log of logs.slice(0, 20)) {
      lines.push(`- [${log.category}] ${log.action}（${log.timestamp.slice(0, 16)}）`)
    }
    if (logs.length > 20) lines.push(`  ...他${logs.length - 20}件`)

    return lines.join('\n')
  }

  if (type === 'chat_sessions') {
    const sessions = context.chatSessions

    if (sessions.length === 0) return 'チャットセッションがありません。'

    const lines: string[] = []
    lines.push('【チャットセッション一覧】')
    lines.push(`合計: ${sessions.length}件`)
    lines.push('')

    for (const s of sessions.slice(0, 20)) {
      lines.push(`- ${s.title}（${s.createdAt.slice(0, 10)}）ID: ${s.id}`)
    }
    if (sessions.length > 20) lines.push(`  ...他${sessions.length - 20}件`)

    return lines.join('\n')
  }

  if (type === 'chat_messages') {
    const sessionId = args.sessionId as string | undefined
    if (!sessionId) return 'sessionIdを指定してください。'

    const messages = context.chatMessages.filter((m) => m.sessionId === sessionId)

    if (messages.length === 0) return '該当するメッセージがありません。'

    const lines: string[] = []
    lines.push(`【チャットメッセージ（セッション: ${sessionId}）】`)
    lines.push(`合計: ${messages.length}件`)
    lines.push('')

    for (const m of messages.slice(0, 30)) {
      const label = m.role === 'user' ? 'ユーザー' : 'リリィ'
      lines.push(`- [${label}] ${m.content.slice(0, 100)}（${m.createdAt.slice(0, 16)}）`)
    }
    if (messages.length > 30) lines.push(`  ...他${messages.length - 30}件`)

    return lines.join('\n')
  }

  return `不明なtype: ${type}`
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

  return `不明なツール: ${name}`
}
