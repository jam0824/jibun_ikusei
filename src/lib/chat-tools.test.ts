import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_TOOLS, executeTool } from './chat-tools'
import type { ToolContext } from './chat-tools'
import type { BrowsingTimeData } from './api-client'

vi.mock('./api-client', () => ({
  getBrowsingTimes: vi.fn(),
  getHealthData: vi.fn(),
  getActivityLogs: vi.fn(),
  getSituationLogs: vi.fn(),
  getChatMessages: vi.fn(),
  postQuest: vi.fn().mockResolvedValue(undefined),
  deleteQuest: vi.fn().mockResolvedValue(undefined),
  putQuest: vi.fn().mockResolvedValue(undefined),
}))

const mockUpsertQuest = vi.fn()
const mockDeleteQuest = vi.fn().mockReturnValue({ ok: true })
const mockArchiveQuest = vi.fn()

vi.mock('@/store/app-store', () => ({
  useAppStore: {
    getState: () => ({
      upsertQuest: mockUpsertQuest,
      deleteQuest: mockDeleteQuest,
      archiveQuest: mockArchiveQuest,
    }),
  },
}))

import * as api from './api-client'

const sampleData: BrowsingTimeData[] = [
  {
    date: '2026-03-23',
    domains: {
      'github.com': { totalSeconds: 3600, category: 'Work', isGrowth: true },
      'youtube.com': { totalSeconds: 1800, category: 'Fun', isGrowth: false },
      'udemy.com': { totalSeconds: 2400, category: 'Study', isGrowth: true },
    },
    totalSeconds: 7800,
  },
]

const sampleHealthData = [
  {
    date: '2026-03-23',
    time: '07:10',
    weight_kg: 65.4,
    body_fat_pct: 18.1,
  },
  {
    date: '2026-03-24',
    time: '07:12',
    weight_kg: 65.1,
    body_fat_pct: 17.9,
  },
]

function createContext(): ToolContext {
  return {
    appState: {
      user: {
        id: 'local_user',
        level: 5,
        totalXp: 450,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-03-23T01:00:00.000Z',
      },
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
          openai: {
            apiKey: 'sk-abcdefgh12345678',
            status: 'verified',
            updatedAt: '2026-03-23T01:00:00.000Z',
            model: 'gpt-5.4',
          },
          gemini: {
            apiKey: undefined,
            status: 'unverified',
            updatedAt: '2026-01-01T00:00:00.000Z',
            model: 'gemini-2.5-flash',
          },
        },
      },
      quests: [
        {
          id: 'q1',
          title: 'Daily Run',
          questType: 'repeatable',
          xpReward: 20,
          category: 'Exercise',
          status: 'active',
          skillMappingMode: 'fixed',
          privacyMode: 'normal',
          pinned: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        {
          id: 'q2',
          title: 'TypeScript Book',
          questType: 'one_time',
          xpReward: 50,
          category: 'Study',
          status: 'active',
          skillMappingMode: 'ai_auto',
          privacyMode: 'normal',
          pinned: true,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-03-15T00:00:00.000Z',
        },
        {
          id: 'q3',
          title: 'Archived Quest',
          questType: 'one_time',
          xpReward: 10,
          category: 'Work',
          status: 'archived',
          skillMappingMode: 'fixed',
          privacyMode: 'normal',
          pinned: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      completions: [
        {
          id: 'c1',
          questId: 'q1',
          clientRequestId: 'cr1',
          completedAt: '2026-03-23T02:00:00.000Z',
          userXpAwarded: 20,
          skillResolutionStatus: 'resolved',
          resolvedSkillId: 's1',
          createdAt: '2026-03-23T02:00:00.000Z',
        },
        {
          id: 'c2',
          questId: 'q1',
          clientRequestId: 'cr2',
          completedAt: '2026-03-19T23:00:00.000Z',
          userXpAwarded: 20,
          skillResolutionStatus: 'resolved',
          resolvedSkillId: 's1',
          createdAt: '2026-03-19T23:00:00.000Z',
        },
        {
          id: 'c3',
          questId: 'q2',
          clientRequestId: 'cr3',
          completedAt: '2026-03-10T01:00:00.000Z',
          userXpAwarded: 50,
          skillResolutionStatus: 'resolved',
          resolvedSkillId: 's2',
          createdAt: '2026-03-10T01:00:00.000Z',
        },
        {
          id: 'c4',
          questId: 'q1',
          clientRequestId: 'cr4',
          completedAt: '2026-03-23T00:00:00.000Z',
          undoneAt: '2026-03-23T00:30:00.000Z',
          userXpAwarded: 20,
          skillResolutionStatus: 'resolved',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
      skills: [
        {
          id: 's1',
          name: 'Running',
          normalizedName: 'running',
          category: 'Exercise',
          level: 3,
          totalXp: 120,
          source: 'seed',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-03-23T00:00:00.000Z',
        },
        {
          id: 's2',
          name: 'TypeScript',
          normalizedName: 'typescript',
          category: 'Study',
          level: 2,
          totalXp: 80,
          source: 'ai',
          status: 'active',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-03-10T00:00:00.000Z',
        },
        {
          id: 's3',
          name: 'Merged Skill',
          normalizedName: 'merged skill',
          category: 'Work',
          level: 1,
          totalXp: 10,
          source: 'manual',
          status: 'merged',
          mergedIntoSkillId: 's2',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      personalSkillDictionary: [
        {
          id: 'd1',
          phrase: 'running',
          mappedSkillId: 's1',
          createdBy: 'user_override',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      assistantMessages: [
        {
          id: 'm1',
          triggerType: 'quest_completed',
          mood: 'bright',
          text: 'great run',
          createdAt: '2026-03-23T02:01:00.000Z',
        },
        {
          id: 'm2',
          triggerType: 'daily_summary',
          mood: 'calm',
          text: 'nice day',
          createdAt: '2026-03-22T13:00:00.000Z',
        },
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
      {
        id: 'cs1',
        title: 'session one',
        createdAt: '2026-03-20T10:00:00.000Z',
        updatedAt: '2026-03-20T10:30:00.000Z',
      },
      {
        id: 'cs2',
        title: 'session two',
        createdAt: '2026-03-23T05:00:00.000Z',
        updatedAt: '2026-03-23T05:30:00.000Z',
      },
    ],
    chatMessages: [
      {
        id: 'cm1',
        sessionId: 'cs2',
        role: 'user',
        content: 'hello',
        createdAt: '2026-03-23T05:00:00.000Z',
      },
      {
        id: 'cm2',
        sessionId: 'cs2',
        role: 'assistant',
        content: 'hi there',
        createdAt: '2026-03-23T05:00:10.000Z',
      },
    ],
  }
}

describe('CHAT_TOOLS', () => {
  it('exposes explicit JST date args on browsing tool', () => {
    const tool = CHAT_TOOLS.find((entry) => entry.function.name === 'get_browsing_times')
    expect(tool).toBeDefined()
    expect(tool?.function.parameters.properties).toHaveProperty('date')
    expect(tool?.function.parameters.properties).toHaveProperty('fromDate')
    expect(tool?.function.parameters.properties).toHaveProperty('toDate')
    expect(tool?.function.parameters.required).not.toContain('period')
  })

  it('exposes explicit JST date args on health data tool', () => {
    const tool = CHAT_TOOLS.find((entry) => entry.function.name === 'get_health_data')
    expect(tool).toBeDefined()
    expect(tool?.function.parameters.properties).toHaveProperty('date')
    expect(tool?.function.parameters.properties).toHaveProperty('fromDate')
    expect(tool?.function.parameters.properties).toHaveProperty('toDate')
    expect(tool?.function.parameters.required).not.toContain('period')
  })
})

describe('get_browsing_times', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T06:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses today period by JST', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    await executeTool('get_browsing_times', { period: 'today' })

    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-03-23', '2026-03-23')
  })

  it('passes explicit date through', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    await executeTool('get_browsing_times', { date: '2026-03-29' })

    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-03-29', '2026-03-29')
  })

  it('returns empty-state message', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue([])

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('閲覧時間データがありません')
  })
})

describe('get_health_data', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T06:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses month period by default', async () => {
    vi.mocked(api.getHealthData).mockResolvedValue(sampleHealthData)

    await executeTool('get_health_data', {})

    expect(api.getHealthData).toHaveBeenCalledWith('2026-02-21', '2026-03-23')
  })

  it('passes explicit date through', async () => {
    vi.mocked(api.getHealthData).mockResolvedValue(sampleHealthData)

    await executeTool('get_health_data', { date: '2026-03-29' })

    expect(api.getHealthData).toHaveBeenCalledWith('2026-03-29', '2026-03-29')
  })

  it('formats returned health records', async () => {
    vi.mocked(api.getHealthData).mockResolvedValue(sampleHealthData)

    const result = await executeTool('get_health_data', { period: 'month' })

    expect(result).toContain('体重・体脂肪率')
    expect(result).toContain('65.4kg')
    expect(result).toContain('18.1%')
  })
})

describe('get_user_info', () => {
  it('returns settings summary', async () => {
    const result = await executeTool('get_user_info', { type: 'settings' }, createContext())

    expect(result).toContain('AI: ON')
    expect(result).toContain('lily')
    expect(result).toContain('08:00')
  })

  it('requires context', async () => {
    const result = await executeTool('get_user_info', { type: 'profile' })
    expect(result).toContain('コンテキスト')
  })
})

describe('get_quest_data', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T06:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists quests with filters', async () => {
    const result = await executeTool('get_quest_data', { type: 'quests', status: 'active' }, createContext())

    expect(result).toContain('Daily Run')
    expect(result).toContain('TypeScript Book')
    expect(result).not.toContain('Archived Quest')
  })

  it('filters completions on a JST day boundary', async () => {
    const ctx = createContext()
    ctx.appState.completions = [
      {
        id: 'boundary-in',
        questId: 'q1',
        clientRequestId: 'r1',
        completedAt: '2026-03-28T15:00:00.000Z',
        userXpAwarded: 20,
        skillResolutionStatus: 'resolved',
        createdAt: '2026-03-28T15:00:00.000Z',
      },
      {
        id: 'boundary-out',
        questId: 'q2',
        clientRequestId: 'r2',
        completedAt: '2026-03-29T15:00:00.000Z',
        userXpAwarded: 50,
        skillResolutionStatus: 'resolved',
        createdAt: '2026-03-29T15:00:00.000Z',
      },
    ]

    const result = await executeTool('get_quest_data', { type: 'completions', date: '2026-03-29' }, ctx)

    expect(result).toContain('+20 XP')
    expect(result).not.toContain('+50 XP')
    expect(result).toContain('2026-03-29')
  })

  it('uses inclusive range filtering for completions', async () => {
    const result = await executeTool(
      'get_quest_data',
      { type: 'completions', fromDate: '2026-03-20', toDate: '2026-03-23' },
      createContext(),
    )

    expect(result).toContain('2026-03-23')
    expect(result).toContain('2026-03-20')
  })
})

describe('get_skill_data', () => {
  it('lists active skills', async () => {
    const result = await executeTool('get_skill_data', { type: 'skills', status: 'active' }, createContext())

    expect(result).toContain('Running')
    expect(result).toContain('TypeScript')
    expect(result).not.toContain('Merged Skill')
  })

  it('lists dictionary mappings', async () => {
    const result = await executeTool('get_skill_data', { type: 'dictionary' }, createContext())

    expect(result).toContain('running')
    expect(result).toContain('Running')
  })
})

describe('get_messages_and_logs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T06:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('filters assistant messages by explicit JST date', async () => {
    const ctx = createContext()
    ctx.appState.assistantMessages = [
      {
        id: 'am1',
        triggerType: 'quest_completed',
        mood: 'bright',
        text: 'included message',
        createdAt: '2026-03-28T15:00:00.000Z',
      },
      {
        id: 'am2',
        triggerType: 'quest_completed',
        mood: 'bright',
        text: 'next day message',
        createdAt: '2026-03-29T15:00:00.000Z',
      },
    ]

    const result = await executeTool(
      'get_messages_and_logs',
      { type: 'assistant_messages', date: '2026-03-29' },
      ctx,
    )

    expect(result).toContain('included message')
    expect(result).not.toContain('next day message')
  })

  it('masks API keys in ai config', async () => {
    const result = await executeTool('get_messages_and_logs', { type: 'ai_config' }, createContext())

    expect(result).toContain('openai')
    expect(result).toContain('sk-a****5678')
    expect(result).not.toContain('sk-abcdefgh12345678')
  })

  it('passes exact day to activity logs API', async () => {
    vi.mocked(api.getActivityLogs).mockResolvedValue([])

    await executeTool('get_messages_and_logs', { type: 'activity_logs', date: '2026-03-29' }, createContext())

    expect(api.getActivityLogs).toHaveBeenCalledWith('2026-03-29', '2026-03-29')
  })

  it('passes range to situation logs API', async () => {
    vi.mocked(api.getSituationLogs).mockResolvedValue([])

    await executeTool(
      'get_messages_and_logs',
      { type: 'situation_logs', fromDate: '2026-03-29', toDate: '2026-03-30' },
      createContext(),
    )

    expect(api.getSituationLogs).toHaveBeenCalledWith('2026-03-29', '2026-03-30')
  })

  it('filters chat sessions by matching message dates', async () => {
    const ctx = createContext()
    ctx.chatSessions = [
      {
        id: 'cs1',
        title: 'session one',
        createdAt: '2026-03-28T15:00:00.000Z',
        updatedAt: '2026-03-29T01:00:00.000Z',
      },
      {
        id: 'cs2',
        title: 'session two',
        createdAt: '2026-03-20T10:00:00.000Z',
        updatedAt: '2026-03-20T10:30:00.000Z',
      },
    ]

    vi.mocked(api.getChatMessages).mockImplementation(async (sessionId: string) => {
      if (sessionId === 'cs1') {
        return [
          { id: 'm1', sessionId, role: 'user', content: 'hit', createdAt: '2026-03-28T15:00:00.000Z' },
        ]
      }
      return [
        { id: 'm2', sessionId, role: 'assistant', content: 'miss', createdAt: '2026-03-29T15:00:00.000Z' },
      ]
    })

    const result = await executeTool(
      'get_messages_and_logs',
      { type: 'chat_sessions', date: '2026-03-29' },
      ctx,
    )

    expect(result).toContain('session one')
    expect(result).not.toContain('session two')
    expect(result).toContain('ID: cs1')
    expect(api.getChatMessages).toHaveBeenCalledTimes(1)
    expect(api.getChatMessages).toHaveBeenCalledWith('cs1')
  })

  it('falls back to context messages when session fetch fails', async () => {
    vi.mocked(api.getChatMessages).mockRejectedValueOnce(new Error('fallback'))

    const result = await executeTool(
      'get_messages_and_logs',
      { type: 'chat_messages', sessionId: 'cs2' },
      createContext(),
    )

    expect(result).toContain('hello')
    expect(result).toContain('hi there')
  })

  it('searches chat messages across sessions when date is provided', async () => {
    const ctx = createContext()
    ctx.chatSessions = [
      {
        id: 'cs1',
        title: 'session one',
        createdAt: '2026-03-28T15:00:00.000Z',
        updatedAt: '2026-03-29T02:00:00.000Z',
      },
      {
        id: 'cs2',
        title: 'session two',
        createdAt: '2026-03-29T00:00:00.000Z',
        updatedAt: '2026-03-29T14:59:59.000Z',
      },
    ]

    vi.mocked(api.getChatMessages).mockImplementation(async (sessionId: string) => {
      if (sessionId === 'cs1') {
        return [
          { id: 'm1', sessionId, role: 'user', content: 'cs1 hit', createdAt: '2026-03-28T15:00:00.000Z' },
        ]
      }
      if (sessionId === 'cs2') {
        return [
          { id: 'm2', sessionId, role: 'assistant', content: 'cs2 hit', createdAt: '2026-03-29T14:59:59.000Z' },
          { id: 'm3', sessionId, role: 'assistant', content: 'outside', createdAt: '2026-03-29T15:00:00.000Z' },
        ]
      }
      return []
    })

    const result = await executeTool(
      'get_messages_and_logs',
      { type: 'chat_messages', date: '2026-03-29' },
      ctx,
    )

    expect(result).toContain('session one')
    expect(result).toContain('session two')
    expect(result).toContain('cs1 hit')
    expect(result).toContain('cs2 hit')
    expect(result).not.toContain('outside')
  })

  it('falls back to cached messages during cross-session date searches', async () => {
    const ctx = createContext()
    ctx.chatSessions = [
      {
        id: 'cs1',
        title: 'session one',
        createdAt: '2026-03-28T15:00:00.000Z',
        updatedAt: '2026-03-29T02:00:00.000Z',
      },
      {
        id: 'cs2',
        title: 'session two',
        createdAt: '2026-03-28T15:10:00.000Z',
        updatedAt: '2026-03-29T03:00:00.000Z',
      },
    ]
    ctx.chatMessages = [
      {
        id: 'cached-cs2',
        sessionId: 'cs2',
        role: 'assistant',
        content: 'cached fallback hit',
        createdAt: '2026-03-28T15:30:00.000Z',
      },
    ]

    vi.mocked(api.getChatMessages).mockImplementation(async (sessionId: string) => {
      if (sessionId === 'cs1') {
        return [
          { id: 'm1', sessionId, role: 'user', content: 'remote hit', createdAt: '2026-03-28T15:05:00.000Z' },
        ]
      }
      throw new Error(`API error: 503 /chat-sessions/${sessionId}/messages`)
    })

    const result = await executeTool(
      'get_messages_and_logs',
      { type: 'chat_messages', date: '2026-03-29' },
      ctx,
    )

    expect(result).toContain('remote hit')
    expect(result).toContain('cached fallback hit')
  })

  it('keeps the sessionId error when no date or range is provided', async () => {
    const result = await executeTool('get_messages_and_logs', { type: 'chat_messages' }, createContext())
    expect(result).toContain('sessionId')
  })
})

describe('mutating tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteQuest.mockReturnValue({ ok: true })
  })

  it('creates a quest with defaults', async () => {
    const result = await executeTool('create_quest', { title: 'Stretch' }, createContext())

    expect(result).toContain('Stretch')
    expect(mockUpsertQuest).toHaveBeenCalledTimes(1)
    expect(mockUpsertQuest.mock.calls[0][0].questType).toBe('repeatable')
  })

  it('archives a quest', async () => {
    const result = await executeTool('delete_quest', { questId: 'q1', mode: 'archive' }, createContext())

    expect(result).toContain('Daily Run')
    expect(mockArchiveQuest).toHaveBeenCalledWith('q1')
  })

  it('deletes a quest by id', async () => {
    const result = await executeTool('delete_quest', { questId: 'q3' }, createContext())

    expect(result).toContain('Archived Quest')
    expect(mockDeleteQuest).toHaveBeenCalledWith('q3')
  })
})
