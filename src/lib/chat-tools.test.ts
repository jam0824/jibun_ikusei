import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeTool, CHAT_TOOLS } from './chat-tools'
import type { ToolContext } from './chat-tools'
import type { BrowsingTimeData } from './api-client'

vi.mock('./api-client', () => ({
  getBrowsingTimes: vi.fn(),
  getActivityLogs: vi.fn(),
}))

import * as api from './api-client'

// ── サンプルデータ ──

const sampleData: BrowsingTimeData[] = [
  {
    date: '2026-03-23',
    domains: {
      'github.com': { totalSeconds: 3600, category: '仕事', isGrowth: true },
      'youtube.com': { totalSeconds: 1800, category: '娯楽', isGrowth: false },
      'udemy.com': { totalSeconds: 2400, category: '学習', isGrowth: true },
    },
    totalSeconds: 7800,
  },
]

const weekData: BrowsingTimeData[] = [
  ...sampleData,
  {
    date: '2026-03-22',
    domains: {
      'github.com': { totalSeconds: 1800, category: '仕事', isGrowth: true },
      'twitter.com': { totalSeconds: 900, category: '娯楽', isGrowth: false },
    },
    totalSeconds: 2700,
  },
]

// テストデータは本番同様 toISOString() (UTC/Z形式) で記録する
// fakeTimerは 2026-03-23T06:00:00.000Z (= JST 15:00)
function createContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    appState: {
      user: { id: 'local_user', level: 5, totalXp: 450, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-03-23T01:00:00.000Z' },
      settings: {
        lilyVoiceEnabled: true,
        lilyAutoPlay: 'on',
        defaultPrivacyMode: 'normal',
        reminderTime: '08:00',
        aiEnabled: true,
        voiceCharacter: 'lily',
        notificationsEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-03-23T01:00:00.000Z',
      },
      aiConfig: {
        activeProvider: 'openai',
        providers: {
          openai: { apiKey: 'sk-abcdefgh12345678', status: 'verified', updatedAt: '2026-03-23T01:00:00.000Z', model: 'gpt-5.4' },
          gemini: { apiKey: undefined, status: 'unverified', updatedAt: '2026-01-01T00:00:00.000Z', model: 'gemini-2.5-flash' },
        },
      },
      quests: [
        { id: 'q1', title: '毎日ランニング', questType: 'repeatable', xpReward: 20, category: '運動', status: 'active', skillMappingMode: 'fixed', privacyMode: 'normal', pinned: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' },
        { id: 'q2', title: 'TypeScript本を読む', questType: 'one_time', xpReward: 50, category: '学習', status: 'active', skillMappingMode: 'ai_auto', privacyMode: 'normal', pinned: true, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-03-15T00:00:00.000Z' },
        { id: 'q3', title: '古いクエスト', questType: 'one_time', xpReward: 10, category: '仕事', status: 'archived', skillMappingMode: 'fixed', privacyMode: 'normal', pinned: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
      ],
      completions: [
        // c1: 3/23 02:00 UTC (= JST 11:00) — "today"
        { id: 'c1', questId: 'q1', clientRequestId: 'cr1', completedAt: '2026-03-23T02:00:00.000Z', userXpAwarded: 20, skillResolutionStatus: 'resolved', resolvedSkillId: 's1', createdAt: '2026-03-23T02:00:00.000Z' },
        // c2: 3/19 23:00 UTC (= JST 3/20 08:00) — "this week"
        { id: 'c2', questId: 'q1', clientRequestId: 'cr2', completedAt: '2026-03-19T23:00:00.000Z', userXpAwarded: 20, skillResolutionStatus: 'resolved', resolvedSkillId: 's1', createdAt: '2026-03-19T23:00:00.000Z' },
        // c3: 3/10 01:00 UTC (= JST 3/10 10:00) — old
        { id: 'c3', questId: 'q2', clientRequestId: 'cr3', completedAt: '2026-03-10T01:00:00.000Z', userXpAwarded: 50, skillResolutionStatus: 'resolved', resolvedSkillId: 's2', createdAt: '2026-03-10T01:00:00.000Z' },
        // c4: 3/23 00:00 UTC — undone
        { id: 'c4', questId: 'q1', clientRequestId: 'cr4', completedAt: '2026-03-23T00:00:00.000Z', undoneAt: '2026-03-23T00:30:00.000Z', userXpAwarded: 20, skillResolutionStatus: 'resolved', createdAt: '2026-03-23T00:00:00.000Z' },
      ],
      skills: [
        { id: 's1', name: '体力', normalizedName: '体力', category: '運動', level: 3, totalXp: 120, source: 'seed', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-03-23T00:00:00.000Z' },
        { id: 's2', name: 'TypeScript', normalizedName: 'typescript', category: '学習', level: 2, totalXp: 80, source: 'ai', status: 'active', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-03-10T00:00:00.000Z' },
        { id: 's3', name: '旧スキル', normalizedName: '旧スキル', category: '仕事', level: 1, totalXp: 10, source: 'manual', status: 'merged', mergedIntoSkillId: 's2', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
      ],
      personalSkillDictionary: [
        { id: 'd1', phrase: 'ランニング', mappedSkillId: 's1', createdBy: 'user_override', createdAt: '2026-02-01T00:00:00.000Z' },
        { id: 'd2', phrase: 'コーディング', mappedSkillId: 's2', createdBy: 'system', createdAt: '2026-02-15T00:00:00.000Z' },
      ],
      assistantMessages: [
        // m1: 3/23 02:01 UTC — "today"
        { id: 'm1', triggerType: 'quest_completed', mood: 'bright', text: 'ランニングお疲れさま！', createdAt: '2026-03-23T02:01:00.000Z' },
        // m2: 3/22 13:00 UTC — "yesterday"
        { id: 'm2', triggerType: 'daily_summary', mood: 'calm', text: '今日も頑張ったね。', createdAt: '2026-03-22T13:00:00.000Z' },
        // m3: old
        { id: 'm3', triggerType: 'quest_completed', mood: 'playful', text: 'TypeScriptすごい！', createdAt: '2026-03-10T01:01:00.000Z' },
      ],
      meta: {
        schemaVersion: 1,
        seededSampleData: true,
        lastDailySummaryDate: '2026-03-22',
        lastWeeklyReflectionWeek: '2026-W12',
        notificationPermission: 'granted',
      },
    },
    chatSessions: [
      { id: 'cs1', title: '最初の会話', createdAt: '2026-03-20T10:00:00.000Z', updatedAt: '2026-03-20T10:30:00.000Z' },
      { id: 'cs2', title: '2回目の会話', createdAt: '2026-03-23T05:00:00.000Z', updatedAt: '2026-03-23T05:30:00.000Z' },
    ],
    chatMessages: [
      { id: 'cm1', sessionId: 'cs2', role: 'user', content: 'こんにちは', createdAt: '2026-03-23T05:00:00.000Z' },
      { id: 'cm2', sessionId: 'cs2', role: 'assistant', content: 'やっほー！', createdAt: '2026-03-23T05:00:10.000Z' },
    ],
  }
}

// ── CHAT_TOOLS 定義テスト ──

describe('CHAT_TOOLS', () => {
  it('get_browsing_timesツールが定義されている', () => {
    const tool = CHAT_TOOLS.find((t) => t.function.name === 'get_browsing_times')
    expect(tool).toBeDefined()
    expect(tool?.type).toBe('function')
    expect(tool?.function.parameters.required).toContain('period')
  })

  it('get_user_infoツールが定義されている', () => {
    const tool = CHAT_TOOLS.find((t) => t.function.name === 'get_user_info')
    expect(tool).toBeDefined()
    expect(tool?.function.parameters.required).toContain('type')
  })

  it('get_quest_dataツールが定義されている', () => {
    const tool = CHAT_TOOLS.find((t) => t.function.name === 'get_quest_data')
    expect(tool).toBeDefined()
    expect(tool?.function.parameters.required).toContain('type')
  })

  it('get_skill_dataツールが定義されている', () => {
    const tool = CHAT_TOOLS.find((t) => t.function.name === 'get_skill_data')
    expect(tool).toBeDefined()
    expect(tool?.function.parameters.required).toContain('type')
  })

  it('get_messages_and_logsツールが定義されている', () => {
    const tool = CHAT_TOOLS.find((t) => t.function.name === 'get_messages_and_logs')
    expect(tool).toBeDefined()
    expect(tool?.function.parameters.required).toContain('type')
  })
})

// ── get_browsing_times（既存テスト） ──

describe('executeTool - get_browsing_times', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T06:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('todayで今日の日付範囲でAPIを呼ぶ', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    await executeTool('get_browsing_times', { period: 'today' })

    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-03-23', '2026-03-23')
  })

  it('weekで直近7日の日付範囲でAPIを呼ぶ', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(weekData)

    await executeTool('get_browsing_times', { period: 'week' })

    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-03-17', '2026-03-23')
  })

  it('monthで直近30日の日付範囲でAPIを呼ぶ', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue([])

    await executeTool('get_browsing_times', { period: 'month' })

    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-02-21', '2026-03-23')
  })

  it('カテゴリ別の集計結果を含むテキストを返す', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('仕事')
    expect(result).toContain('娯楽')
    expect(result).toContain('学習')
  })

  it('サイト別の集計結果を含むテキストを返す', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('github.com')
    expect(result).toContain('youtube.com')
    expect(result).toContain('udemy.com')
  })

  it('時間が「X時間Y分」形式で整形される', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('1時間0分')  // github.com 3600s
    expect(result).toContain('30分')       // youtube.com 1800s
  })

  it('データが空の場合に適切なメッセージを返す', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue([])

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('閲覧データがありません')
  })

  it('未知のツール名でエラー文字列を返す', async () => {
    const ctx = createContext()
    const result = await executeTool('unknown_tool', {}, ctx)

    expect(result).toContain('不明なツール')
  })

  it('API呼び出しが失敗した場合にエラー文字列を返す', async () => {
    vi.mocked(api.getBrowsingTimes).mockRejectedValue(new Error('Network error'))

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('取得に失敗')
  })
})

// ── get_user_info ──

describe('executeTool - get_user_info', () => {
  it('type=profileでレベルと総XPを含む', async () => {
    const ctx = createContext()
    const result = await executeTool('get_user_info', { type: 'profile' }, ctx)

    expect(result).toContain('レベル: 5')
    expect(result).toContain('総XP: 450')
  })

  it('type=settingsで設定項目を含む', async () => {
    const ctx = createContext()
    const result = await executeTool('get_user_info', { type: 'settings' }, ctx)

    expect(result).toContain('リリィ音声: ON')
    expect(result).toContain('AI: ON')
    expect(result).toContain('通知: ON')
  })

  it('type=metaでメタ情報を含む', async () => {
    const ctx = createContext()
    const result = await executeTool('get_user_info', { type: 'meta' }, ctx)

    expect(result).toContain('スキーマバージョン: 1')
    expect(result).toContain('最終日次サマリー: 2026-03-22')
    expect(result).toContain('通知権限: granted')
  })

  it('contextなしでエラーを返す', async () => {
    const result = await executeTool('get_user_info', { type: 'profile' })

    expect(result).toContain('データを取得できません')
  })
})

// ── get_quest_data ──

describe('executeTool - get_quest_data', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T06:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('type=questsで全クエスト一覧を返す', async () => {
    const ctx = createContext()
    const result = await executeTool('get_quest_data', { type: 'quests' }, ctx)

    expect(result).toContain('毎日ランニング')
    expect(result).toContain('TypeScript本を読む')
    expect(result).toContain('古いクエスト')
    expect(result).toContain('合計: 3件')
  })

  it('type=quests + status=activeでフィルタされる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_quest_data', { type: 'quests', status: 'active' }, ctx)

    expect(result).toContain('毎日ランニング')
    expect(result).toContain('TypeScript本を読む')
    expect(result).not.toContain('古いクエスト')
    expect(result).toContain('合計: 2件')
  })

  it('type=quests + questType=repeatableでフィルタされる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_quest_data', { type: 'quests', questType: 'repeatable' }, ctx)

    expect(result).toContain('毎日ランニング')
    expect(result).not.toContain('TypeScript本を読む')
  })

  it('type=quests + categoryでフィルタされる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_quest_data', { type: 'quests', category: '学習' }, ctx)

    expect(result).toContain('TypeScript本を読む')
    expect(result).not.toContain('毎日ランニング')
  })

  it('type=completionsで完了記録を返す（undoneAtありは除外）', async () => {
    const ctx = createContext()
    const result = await executeTool('get_quest_data', { type: 'completions' }, ctx)

    expect(result).toContain('毎日ランニング')
    expect(result).toContain('+20 XP')
    // undone（c4）は含まれない
    expect(result).toContain('合計: 3件')
  })

  it('type=completions + period=todayで今日のみ', async () => {
    const ctx = createContext()
    const result = await executeTool('get_quest_data', { type: 'completions', period: 'today' }, ctx)

    expect(result).toContain('毎日ランニング')
    // c2(3/19 UTC)とc3(3/10 UTC)は含まれない
    expect(result).toContain('合計: 1件')
  })

  it('type=completions + questIdでフィルタされる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_quest_data', { type: 'completions', questId: 'q2' }, ctx)

    expect(result).toContain('TypeScript本を読む')
    expect(result).toContain('合計: 1件')
  })
})

// ── get_skill_data ──

describe('executeTool - get_skill_data', () => {
  it('type=skillsで全スキル一覧を返す', async () => {
    const ctx = createContext()
    const result = await executeTool('get_skill_data', { type: 'skills' }, ctx)

    expect(result).toContain('体力')
    expect(result).toContain('TypeScript')
    expect(result).toContain('旧スキル')
    expect(result).toContain('合計: 3件')
  })

  it('type=skills + status=activeでフィルタされる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_skill_data', { type: 'skills', status: 'active' }, ctx)

    expect(result).toContain('体力')
    expect(result).toContain('TypeScript')
    expect(result).not.toContain('旧スキル')
  })

  it('type=skills + categoryでフィルタされる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_skill_data', { type: 'skills', category: '運動' }, ctx)

    expect(result).toContain('体力')
    expect(result).not.toContain('TypeScript')
  })

  it('スキルのレベルとXPが含まれる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_skill_data', { type: 'skills' }, ctx)

    expect(result).toContain('Lv.3')
    expect(result).toContain('120 XP')
  })

  it('type=dictionaryで辞書エントリを返す', async () => {
    const ctx = createContext()
    const result = await executeTool('get_skill_data', { type: 'dictionary' }, ctx)

    expect(result).toContain('ランニング')
    expect(result).toContain('体力')
    expect(result).toContain('コーディング')
    expect(result).toContain('TypeScript')
    expect(result).toContain('合計: 2件')
  })
})

// ── get_messages_and_logs ──

describe('executeTool - get_messages_and_logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T06:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('type=assistant_messagesでメッセージ一覧を返す', async () => {
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'assistant_messages' }, ctx)

    expect(result).toContain('ランニングお疲れさま！')
    expect(result).toContain('今日も頑張ったね。')
    expect(result).toContain('合計: 3件')
  })

  it('type=assistant_messages + triggerTypeでフィルタされる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'assistant_messages', triggerType: 'daily_summary' }, ctx)

    expect(result).toContain('今日も頑張ったね。')
    expect(result).not.toContain('ランニングお疲れさま！')
    expect(result).toContain('合計: 1件')
  })

  it('type=assistant_messages + period=todayでフィルタされる', async () => {
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'assistant_messages', period: 'today' }, ctx)

    // m1 (3/23 02:01Z) は startOfDay(3/23T06:00Z)=3/23T00:00Z 以降 → today
    expect(result).toContain('ランニングお疲れさま！')
    expect(result).toContain('合計: 1件')
  })

  it('type=ai_configでAPIキーがマスクされている', async () => {
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'ai_config' }, ctx)

    expect(result).toContain('openai')
    expect(result).toContain('verified')
    expect(result).not.toContain('sk-abcdefgh12345678')
    expect(result).toContain('sk-a****5678')
  })

  it('type=activity_logsでAPI経由でログを取得する', async () => {
    vi.mocked(api.getActivityLogs).mockResolvedValue([
      { timestamp: '2026-03-23T02:00:00.000Z', source: 'app', action: 'quest_completed', category: 'クエスト', details: { questId: 'q1' } },
      { timestamp: '2026-03-23T04:00:00.000Z', source: 'app', action: 'skill_level_up', category: 'スキル', details: { skillId: 's1' } },
    ])
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'activity_logs', period: 'today' }, ctx)

    expect(api.getActivityLogs).toHaveBeenCalledWith('2026-03-23', '2026-03-23')
    expect(result).toContain('quest_completed')
    expect(result).toContain('skill_level_up')
    expect(result).toContain('合計: 2件')
  })

  it('type=activity_logs + period=weekで7日間取得する', async () => {
    vi.mocked(api.getActivityLogs).mockResolvedValue([])
    const ctx = createContext()
    await executeTool('get_messages_and_logs', { type: 'activity_logs', period: 'week' }, ctx)

    expect(api.getActivityLogs).toHaveBeenCalledWith('2026-03-17', '2026-03-23')
  })

  it('type=activity_logsのAPI失敗時にエラーメッセージを返す', async () => {
    vi.mocked(api.getActivityLogs).mockRejectedValue(new Error('Network error'))
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'activity_logs' }, ctx)

    expect(result).toContain('取得に失敗')
  })

  it('type=chat_sessionsでセッション一覧を返す', async () => {
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'chat_sessions' }, ctx)

    expect(result).toContain('最初の会話')
    expect(result).toContain('2回目の会話')
    expect(result).toContain('合計: 2件')
  })

  it('type=chat_messages + sessionIdでメッセージを返す', async () => {
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'chat_messages', sessionId: 'cs2' }, ctx)

    expect(result).toContain('こんにちは')
    expect(result).toContain('やっほー！')
    expect(result).toContain('合計: 2件')
  })

  it('type=chat_messages + sessionIdなしでエラーを返す', async () => {
    const ctx = createContext()
    const result = await executeTool('get_messages_and_logs', { type: 'chat_messages' }, ctx)

    expect(result).toContain('sessionId')
  })
})
