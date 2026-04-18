import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActivitySession,
  DailyActivityLog,
  RawEvent,
  WeeklyActivityReview,
} from '@/domain/action-log-types'
import { hydratePersistedState } from '@/domain/logic'
import type { Quest, QuestCompletion } from '@/domain/types'
import type {
  FitbitSummary,
  HealthDataEntry,
  NutritionDayResult,
  SituationLogEntry,
} from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({
  deleteActionLogRange: vi.fn(),
  getCompletions: vi.fn(),
  getActionLogDailyActivityLog: vi.fn(),
  getActionLogDailyActivityLogs: vi.fn(),
  getActionLogRawEvents: vi.fn(),
  getActionLogRawEventsPage: vi.fn(),
  getActionLogSessions: vi.fn(),
  getActionLogSessionsPage: vi.fn(),
  getActionLogWeeklyActivityReview: vi.fn(),
  getActionLogWeeklyActivityReviews: vi.fn(),
  getHealthData: vi.fn(),
  getFitbitData: vi.fn(),
  getNutrition: vi.fn(),
  getQuests: vi.fn(),
  getSituationLogs: vi.fn(),
  putActionLogDailyActivityLog: vi.fn(),
  putActionLogSessionHidden: vi.fn(),
  putActionLogWeeklyActivityReview: vi.fn(),
}))

vi.mock('@/lib/ai', () => ({
  generateDailyActivityLogSummary: vi.fn(),
  generateDailyQuestSummary: vi.fn(),
  generateDailyHealthSummary: vi.fn(),
  generateWeeklyActivityReview: vi.fn(),
}))

import * as api from '@/lib/api-client'
import * as ai from '@/lib/ai'
import {
  buildCompactSessionBlocks,
  canDeleteActionLogRange,
  deleteActionLogDateRange,
  ensurePreviousDayDailyActivityLog,
  ensurePreviousDayDailyActivityLogShell,
  ensurePreviousWeekReviewForWeb,
  exportActionLogBundle,
  fetchActivityDayEventPage,
  fetchActivityDaySessionPage,
  fetchActivityDayShell,
  fetchActivityDayView,
  fetchActivityReviewWeek,
  resolveDefaultReviewYearJst,
  searchActivityLogs,
  setActivitySessionHidden,
} from '@/lib/action-log-view'

function createSession(id: string, overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id,
    deviceId: 'device_main',
    startedAt: '2026-04-16T09:00:00+09:00',
    endedAt: '2026-04-16T09:40:00+09:00',
    dateKey: '2026-04-16',
    title: 'Chrome docs research',
    primaryCategory: 'study',
    activityKinds: ['research'],
    appNames: ['Chrome'],
    domains: ['developer.chrome.com'],
    projectNames: [],
    summary: 'Looked through Chrome extension docs.',
    searchKeywords: ['chrome', 'docs'],
    noteIds: [],
    hidden: false,
    ...overrides,
  }
}

function createRawEvent(id: string, overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id,
    deviceId: 'device_main',
    source: 'chrome_extension',
    eventType: 'browser_page_changed',
    occurredAt: '2026-04-16T09:05:00+09:00',
    appName: 'Chrome',
    windowTitle: 'Manifest V3',
    url: 'https://developer.chrome.com/docs/extensions',
    domain: 'developer.chrome.com',
    metadata: {},
    expiresAt: '2026-05-16T09:05:00+09:00',
    ...overrides,
  }
}

function createQuest(id = 'quest_1', overrides: Partial<Quest> = {}): Quest {
  return {
    id,
    title: '朝の読書',
    description: '静かな読書時間',
    questType: 'repeatable',
    xpReward: 5,
    category: '学習',
    skillMappingMode: 'ask_each_time',
    cooldownMinutes: 0,
    dailyCompletionCap: 10,
    status: 'active',
    privacyMode: 'normal',
    pinned: false,
    createdAt: '2026-04-16T07:00:00+09:00',
    updatedAt: '2026-04-16T07:00:00+09:00',
    ...overrides,
  }
}

function createCompletion(
  id = 'completion_1',
  questId = 'quest_1',
  overrides: Partial<QuestCompletion> = {},
): QuestCompletion {
  return {
    id,
    questId,
    clientRequestId: `req_${id}`,
    completedAt: '2026-04-16T08:00:00+09:00',
    userXpAwarded: 5,
    skillResolutionStatus: 'resolved',
    createdAt: '2026-04-16T08:00:00+09:00',
    ...overrides,
  }
}

function createHealthDataEntry(overrides: Partial<HealthDataEntry> = {}): HealthDataEntry {
  return {
    date: '2026-04-16',
    time: '07:10',
    weight_kg: 61.2,
    body_fat_pct: 18.1,
    source: 'health-planet',
    ...overrides,
  }
}

function createSituationLog(
  timestamp = '2026-04-16T18:30:00+09:00',
  overrides: Partial<SituationLogEntry> = {},
): SituationLogEntry {
  return {
    summary: '直近30分は実装と確認を静かに行き来していた。',
    timestamp,
    details: {
      active_apps: ['Code', 'Chrome'],
    },
    ...overrides,
  }
}

function createFitbitSummary(overrides: Partial<FitbitSummary> = {}): FitbitSummary {
  return {
    date: '2026-04-16',
    heart: {
      resting_heart_rate: 58,
      intraday_points: 0,
      heart_zones: [],
    },
    active_zone_minutes: {
      intraday_points: 0,
      minutes_total_estimate: 22,
      summary_rows: 1,
    },
    sleep: {
      main_sleep: {
        date_of_sleep: '2026-04-16',
        start_time: '2026-04-15T23:45:00.000',
        end_time: '2026-04-16T06:40:00.000',
        minutes_asleep: 390,
        minutes_awake: 25,
        time_in_bed: 415,
        deep_minutes: 70,
        light_minutes: 240,
        rem_minutes: 80,
        wake_minutes: 25,
      },
      all_sleep_count: 1,
    },
    activity: {
      steps: 8123,
      distance: 5.4,
      calories: 2100,
      very_active_minutes: 12,
      fairly_active_minutes: 18,
      lightly_active_minutes: 30,
      sedentary_minutes: 500,
    },
    ...overrides,
  }
}

function createNutritionDayResult(): NutritionDayResult {
  return {
    breakfast: null,
    lunch: null,
    dinner: null,
    daily: {
      userId: 'user_1',
      date: '2026-04-16',
      mealType: 'daily',
      nutrients: {
        energy: { value: 1850, unit: 'kcal', label: '適正', threshold: null },
        protein: { value: 70, unit: 'g', label: '適正', threshold: null },
        fat: { value: 55, unit: 'g', label: '適正', threshold: null },
        carbs: { value: 230, unit: 'g', label: '適正', threshold: null },
        potassium: { value: 1800, unit: 'mg', label: '不足', threshold: null },
        calcium: { value: 700, unit: 'mg', label: '適正', threshold: null },
        iron: { value: 7, unit: 'mg', label: '適正', threshold: null },
        vitaminA: { value: 650, unit: 'µg', label: '適正', threshold: null },
        vitaminE: { value: 6, unit: 'mg', label: '適正', threshold: null },
        vitaminB1: { value: 0.8, unit: 'mg', label: '不足', threshold: null },
        vitaminB2: { value: 1.2, unit: 'mg', label: '適正', threshold: null },
        vitaminB6: { value: 1.0, unit: 'mg', label: '適正', threshold: null },
        vitaminC: { value: 90, unit: 'mg', label: '適正', threshold: null },
        fiber: { value: 14, unit: 'g', label: '不足', threshold: null },
        saturatedFat: { value: 7, unit: 'g', label: '適正', threshold: null },
        salt: { value: 9, unit: 'g', label: '過剰', threshold: null },
      },
      createdAt: '2026-04-16T20:00:00+09:00',
      updatedAt: '2026-04-16T20:00:00+09:00',
    },
  }
}

function createDailyLog(dateKey = '2026-04-16', overrides: Partial<DailyActivityLog> = {}): DailyActivityLog {
  return {
    id: `daily_${dateKey}`,
    dateKey,
    summary: 'Lily noted a steady day of research and implementation.',
    questSummary: 'Lily noted a small but steady trail of quest clears through the day.',
    healthSummary: 'Lily saw a quiet health record that still left a few steady marks.',
    mainThemes: ['Chrome docs', 'research'],
    noteIds: [],
    reviewQuestions: ['What should be explored next?'],
    generatedAt: `${dateKey}T22:00:00+09:00`,
    ...overrides,
  }
}

function createWeeklyReview(
  weekKey = '2026-W16',
  overrides: Partial<WeeklyActivityReview> = {},
): WeeklyActivityReview {
  return {
    id: `weekly_${weekKey}`,
    weekKey,
    summary: 'Lily observed a week centered on research and implementation.',
    categoryDurations: { study: 40 },
    focusThemes: ['Chrome docs'],
    generatedAt: '2026-04-18T08:00:00+09:00',
    ...overrides,
  }
}

describe('action log view orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-17T09:00:00+09:00'))

    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_1'),
      createSession('session_2', {
        id: 'session_2',
        dateKey: '2026-04-17',
        startedAt: '2026-04-17T10:00:00+09:00',
        endedAt: '2026-04-17T10:20:00+09:00',
        title: 'VS Code implementation',
        primaryCategory: 'work',
        activityKinds: ['implementation'],
        appNames: ['Code'],
        domains: [],
        searchKeywords: ['vscode', 'implementation'],
      }),
    ])
    vi.mocked(api.getActionLogRawEvents).mockResolvedValue([createRawEvent('event_1')])
    vi.mocked(api.getActionLogRawEventsPage).mockResolvedValue({
      items: [createRawEvent('event_1')],
      nextCursor: null,
    })
    vi.mocked(api.getCompletions).mockResolvedValue([createCompletion()])
    vi.mocked(api.getActionLogDailyActivityLog).mockResolvedValue(null)
    vi.mocked(api.getActionLogSessionsPage).mockResolvedValue({
      items: [createSession('session_2')],
      nextCursor: null,
    })
    vi.mocked(api.getActionLogWeeklyActivityReview).mockResolvedValue(null)
    vi.mocked(api.getHealthData).mockResolvedValue([createHealthDataEntry()])
    vi.mocked(api.getFitbitData).mockResolvedValue([createFitbitSummary()])
    vi.mocked(api.getNutrition).mockResolvedValue(createNutritionDayResult())
    vi.mocked(api.getQuests).mockResolvedValue([createQuest()])
    vi.mocked(api.getSituationLogs).mockResolvedValue([createSituationLog()])
    vi.mocked(api.putActionLogDailyActivityLog).mockImplementation(async (log) => log)
    vi.mocked(api.putActionLogWeeklyActivityReview).mockImplementation(async (review) => review)
    vi.mocked(api.putActionLogSessionHidden).mockImplementation(async (_id, input) =>
      createSession('session_1', { hidden: input.hidden }),
    )
    vi.mocked(api.getActionLogDailyActivityLogs).mockResolvedValue([createDailyLog('2026-04-16')])
    vi.mocked(api.getActionLogWeeklyActivityReviews).mockResolvedValue([
      createWeeklyReview('2026-W16'),
    ])
    vi.mocked(api.deleteActionLogRange).mockResolvedValue({
      deleted: {
        rawEvents: 1,
        sessions: 1,
        dailyLogs: 1,
        weeklyReviews: 1,
        situationLogs: 2,
      },
      deletionRequestId: 'delete_1',
    })
  })

  it('generates and saves missing DailyActivityLog sections only for yesterday', async () => {
    const state = hydratePersistedState()
    vi.mocked(ai.generateDailyActivityLogSummary).mockResolvedValue({
      summary: 'Lily stitched together the day from the surrounding sessions.',
      mainThemes: ['Chrome docs', 'research'],
      reviewQuestions: ['What should be explored next?'],
    })
    vi.mocked(ai.generateDailyQuestSummary).mockRejectedValue(new Error('quest failed'))
    vi.mocked(ai.generateDailyHealthSummary).mockResolvedValue({
      healthSummary: 'Lily saw a single health record quietly anchor the morning.',
    })

    const result = await ensurePreviousDayDailyActivityLog({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-16',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(ai.generateDailyActivityLogSummary).toHaveBeenCalledTimes(1)
    expect(ai.generateDailyQuestSummary).toHaveBeenCalledTimes(1)
    expect(ai.generateDailyHealthSummary).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ai.generateDailyActivityLogSummary).mock.calls[0][0]).toMatchObject({
      dateKey: '2026-04-16',
      sessions: [createSession('session_1')],
    })
    expect(vi.mocked(ai.generateDailyActivityLogSummary).mock.calls[0][0]).not.toHaveProperty('rawEvents')
    expect(vi.mocked(ai.generateDailyQuestSummary).mock.calls[0][0]).toMatchObject({
      dateKey: '2026-04-16',
      quests: [createQuest()],
      completions: [createCompletion()],
    })
    expect(vi.mocked(ai.generateDailyHealthSummary).mock.calls[0][0]).toMatchObject({
      dateKey: '2026-04-16',
      healthData: [createHealthDataEntry()],
      fitbitData: [createFitbitSummary()],
      nutritionData: createNutritionDayResult(),
    })
    expect(api.putActionLogDailyActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'daily_2026-04-16',
        dateKey: '2026-04-16',
        summary: 'Lily stitched together the day from the surrounding sessions.',
        healthSummary: 'Lily saw a single health record quietly anchor the morning.',
        questSummary: undefined,
      }),
    )
    expect(result.dailyLog?.summary).toBe('Lily stitched together the day from the surrounding sessions.')
    expect(result.dailyLog?.questSummary).toBeUndefined()
    expect(result.dailyLog?.healthSummary).toBe('Lily saw a single health record quietly anchor the morning.')
  })

  it('sorts same-day sessions and raw events newest first in fetchActivityDayView', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_old', {
        dateKey: '2026-04-16',
        startedAt: '2026-04-16T09:00:00+09:00',
        endedAt: '2026-04-16T09:20:00+09:00',
      }),
      createSession('session_new', {
        dateKey: '2026-04-16',
        startedAt: '2026-04-16T11:00:00+09:00',
        endedAt: '2026-04-16T11:20:00+09:00',
      }),
    ])
    vi.mocked(api.getActionLogRawEvents).mockResolvedValue([
      createRawEvent('event_old', {
        occurredAt: '2026-04-16T09:05:00+09:00',
        windowTitle: 'Older event',
      }),
      createRawEvent('event_new', {
        occurredAt: '2026-04-16T11:05:00+09:00',
        windowTitle: 'Newer event',
      }),
    ])

    const result = await fetchActivityDayView('2026-04-16')

    expect(result.sessions.map((session) => session.id)).toEqual(['session_new', 'session_old'])
    expect(result.rawEvents.map((event) => event.id)).toEqual(['event_new', 'event_old'])
  })

  it('sorts same-day sessions and raw events newest first in ensurePreviousDayDailyActivityLog', async () => {
    const state = hydratePersistedState()
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('session_old', {
        dateKey: '2026-04-16',
        startedAt: '2026-04-16T09:00:00+09:00',
        endedAt: '2026-04-16T09:20:00+09:00',
      }),
      createSession('session_new', {
        dateKey: '2026-04-16',
        startedAt: '2026-04-16T11:00:00+09:00',
        endedAt: '2026-04-16T11:20:00+09:00',
      }),
    ])
    vi.mocked(api.getActionLogRawEvents).mockResolvedValue([
      createRawEvent('event_old', {
        occurredAt: '2026-04-16T09:05:00+09:00',
        windowTitle: 'Older event',
      }),
      createRawEvent('event_new', {
        occurredAt: '2026-04-16T11:05:00+09:00',
        windowTitle: 'Newer event',
      }),
    ])
    vi.mocked(api.getActionLogDailyActivityLog).mockResolvedValue(createDailyLog('2026-04-16'))

    const result = await ensurePreviousDayDailyActivityLog({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-16',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(result.sessions.map((session) => session.id)).toEqual(['session_new', 'session_old'])
    expect(result.rawEvents.map((event) => event.id)).toEqual(['event_new', 'event_old'])
  })

  it('fetches the day shell without loading timeline pages', async () => {
    vi.mocked(api.getActionLogDailyActivityLog).mockResolvedValue(createDailyLog('2026-04-16'))
    vi.mocked(api.getSituationLogs).mockResolvedValue([
      createSituationLog('2026-04-16T18:00:00+09:00', { summary: 'older summary' }),
      createSituationLog('2026-04-16T19:00:00+09:00', { summary: 'newer summary' }),
    ])

    const result = await fetchActivityDayShell('2026-04-16')

    expect(api.getActionLogDailyActivityLog).toHaveBeenCalledWith('2026-04-16')
    expect(api.getSituationLogs).toHaveBeenCalledWith('2026-04-16', '2026-04-16')
    expect(api.getActionLogSessionsPage).not.toHaveBeenCalled()
    expect(api.getActionLogRawEventsPage).not.toHaveBeenCalled()
    expect(result.dailyLog?.id).toBe('daily_2026-04-16')
    expect(result.situationLogs.map((log) => log.summary)).toEqual(['newer summary', 'older summary'])
  })

  it('fetches a paged session timeline for the day', async () => {
    vi.mocked(api.getActionLogSessionsPage).mockResolvedValue({
      items: [
        createSession('session_new', {
          startedAt: '2026-04-16T11:00:00+09:00',
          endedAt: '2026-04-16T11:20:00+09:00',
        }),
      ],
      nextCursor: 'cursor_sessions_2',
    })

    const result = await fetchActivityDaySessionPage({
      dateKey: '2026-04-16',
      cursor: 'cursor_sessions_1',
      includeHidden: true,
    })

    expect(api.getActionLogSessionsPage).toHaveBeenCalledWith({
      from: '2026-04-16',
      to: '2026-04-16',
      limit: 50,
      cursor: 'cursor_sessions_1',
      includeHidden: true,
    })
    expect(result.items.map((session) => session.id)).toEqual(['session_new'])
    expect(result.nextCursor).toBe('cursor_sessions_2')
  })

  it('fetches a paged raw-event timeline for the day', async () => {
    vi.mocked(api.getActionLogRawEventsPage).mockResolvedValue({
      items: [
        createRawEvent('event_new', {
          occurredAt: '2026-04-16T11:05:00+09:00',
          windowTitle: 'Newer event',
        }),
      ],
      nextCursor: 'cursor_events_2',
    })

    const result = await fetchActivityDayEventPage({
      dateKey: '2026-04-16',
      cursor: 'cursor_events_1',
    })

    expect(api.getActionLogRawEventsPage).toHaveBeenCalledWith({
      from: '2026-04-16',
      to: '2026-04-16',
      limit: 50,
      cursor: 'cursor_events_1',
    })
    expect(result.items.map((event) => event.id)).toEqual(['event_new'])
    expect(result.nextCursor).toBe('cursor_events_2')
  })

  it('ensures a missing previous-day daily log shell without loading timeline pages', async () => {
    const state = hydratePersistedState()
    vi.mocked(api.getActionLogDailyActivityLog).mockResolvedValue(null)
    vi.mocked(ai.generateDailyActivityLogSummary).mockResolvedValue({
      summary: 'Generated summary for yesterday only.',
      mainThemes: ['Chrome docs'],
      reviewQuestions: ['What remains open?'],
    })
    vi.mocked(ai.generateDailyQuestSummary).mockResolvedValue({
      questSummary: 'Generated quest summary for yesterday only.',
    })
    vi.mocked(ai.generateDailyHealthSummary).mockResolvedValue({
      healthSummary: 'Generated health summary for yesterday only.',
    })

    const result = await ensurePreviousDayDailyActivityLogShell({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-16',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(api.getActionLogSessions).toHaveBeenCalledWith('2026-04-16', '2026-04-16')
    expect(api.getActionLogSessionsPage).not.toHaveBeenCalled()
    expect(api.getActionLogRawEventsPage).not.toHaveBeenCalled()
    expect(result.dailyLog?.summary).toBe('Generated summary for yesterday only.')
    expect(result.dailyLog?.questSummary).toBe('Generated quest summary for yesterday only.')
    expect(result.dailyLog?.healthSummary).toBe('Generated health summary for yesterday only.')
  })

  it('compacts short alternating YouTube and Codex sessions into two blocks', async () => {
    const blocks = buildCompactSessionBlocks([
      createSession('youtube_1', {
        startedAt: '2026-04-16T14:19:00+09:00',
        endedAt: '2026-04-16T14:19:20+09:00',
        title: 'YouTube page',
        summary: undefined,
        primaryCategory: '娯楽',
        activityKinds: ['視聴'],
        appNames: ['chrome.exe'],
        domains: ['youtube.com'],
      }),
      createSession('codex_1', {
        startedAt: '2026-04-16T14:18:40+09:00',
        endedAt: '2026-04-16T14:18:55+09:00',
        title: 'Codex task',
        summary: undefined,
        primaryCategory: '仕事',
        activityKinds: ['開発'],
        appNames: ['Codex.exe'],
        domains: [],
      }),
      createSession('youtube_2', {
        startedAt: '2026-04-16T14:18:10+09:00',
        endedAt: '2026-04-16T14:18:30+09:00',
        title: 'Ancient Egypt video',
        summary: undefined,
        primaryCategory: '娯楽',
        activityKinds: ['視聴'],
        appNames: ['chrome.exe'],
        domains: ['youtube.com'],
      }),
      createSession('codex_2', {
        startedAt: '2026-04-16T14:17:50+09:00',
        endedAt: '2026-04-16T14:18:00+09:00',
        title: 'Codex note',
        summary: undefined,
        primaryCategory: '仕事',
        activityKinds: ['開発'],
        appNames: ['Codex.exe'],
        domains: [],
      }),
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks.map((block) => block.kind)).toEqual(['compact', 'compact'])
    expect(blocks.map((block) => block.primaryText)).toEqual(['YouTubeで動画を視聴', 'Codexでコード作業'])
    expect(blocks[0]).toMatchObject({
      sessionIds: ['youtube_1', 'youtube_2'],
      sessionCount: 2,
      startedAt: '2026-04-16T14:18:10+09:00',
      endedAt: '2026-04-16T14:19:20+09:00',
    })
    expect(blocks[1]).toMatchObject({
      sessionIds: ['codex_1', 'codex_2'],
      sessionCount: 2,
      startedAt: '2026-04-16T14:17:50+09:00',
      endedAt: '2026-04-16T14:18:55+09:00',
    })
  })

  it('keeps a different domain as a single block inside the same burst', async () => {
    const blocks = buildCompactSessionBlocks([
      createSession('youtube_1', {
        startedAt: '2026-04-16T14:19:00+09:00',
        endedAt: '2026-04-16T14:19:15+09:00',
        title: 'YouTube page',
        summary: undefined,
        activityKinds: ['視聴'],
        appNames: ['chrome.exe'],
        domains: ['youtube.com'],
      }),
      createSession('github_1', {
        startedAt: '2026-04-16T14:18:40+09:00',
        endedAt: '2026-04-16T14:18:55+09:00',
        title: 'PR page',
        summary: undefined,
        activityKinds: ['調査'],
        appNames: ['chrome.exe'],
        domains: ['github.com'],
      }),
      createSession('youtube_2', {
        startedAt: '2026-04-16T14:18:10+09:00',
        endedAt: '2026-04-16T14:18:25+09:00',
        title: 'YouTube video',
        summary: undefined,
        activityKinds: ['視聴'],
        appNames: ['chrome.exe'],
        domains: ['youtube.com'],
      }),
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks.map((block) => block.kind)).toEqual(['compact', 'single'])
    expect(blocks[0].primaryText).toBe('YouTubeで動画を視聴')
    expect(blocks[1].representativeSession.id).toBe('github_1')
  })

  it('does not compact sessions when the gap exceeds five minutes', async () => {
    const blocks = buildCompactSessionBlocks([
      createSession('codex_1', {
        startedAt: '2026-04-16T14:19:00+09:00',
        endedAt: '2026-04-16T14:19:20+09:00',
        title: 'Codex task 1',
        summary: undefined,
        activityKinds: ['開発'],
        appNames: ['Codex.exe'],
        domains: [],
      }),
      createSession('codex_2', {
        startedAt: '2026-04-16T14:12:00+09:00',
        endedAt: '2026-04-16T14:12:20+09:00',
        title: 'Codex task 2',
        summary: undefined,
        activityKinds: ['開発'],
        appNames: ['Codex.exe'],
        domains: [],
      }),
      createSession('codex_3', {
        startedAt: '2026-04-16T14:05:00+09:00',
        endedAt: '2026-04-16T14:05:20+09:00',
        title: 'Codex task 3',
        summary: undefined,
        activityKinds: ['開発'],
        appNames: ['Codex.exe'],
        domains: [],
      }),
    ])

    expect(blocks).toHaveLength(3)
    expect(blocks.every((block) => block.kind === 'single')).toBe(true)
  })

  it('retries only missing previous-day daily log sections for incomplete logs', async () => {
    const state = hydratePersistedState()
    vi.mocked(api.getActionLogDailyActivityLog).mockResolvedValue(
      createDailyLog('2026-04-16', {
        questSummary: undefined,
        healthSummary: undefined,
      }),
    )
    vi.mocked(ai.generateDailyActivityLogSummary).mockResolvedValue({
      summary: 'This should not be regenerated.',
      mainThemes: ['unexpected'],
      reviewQuestions: ['unexpected'],
    })
    vi.mocked(ai.generateDailyQuestSummary).mockResolvedValue({
      questSummary: 'Quest summary based on same-day quest completions.',
    })
    vi.mocked(ai.generateDailyHealthSummary).mockResolvedValue({
      healthSummary: 'Health summary based on same-day health data.',
    })

    const generated = await ensurePreviousDayDailyActivityLog({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-16',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(ai.generateDailyActivityLogSummary).not.toHaveBeenCalled()
    expect(ai.generateDailyQuestSummary).toHaveBeenCalledTimes(1)
    expect(ai.generateDailyHealthSummary).toHaveBeenCalledTimes(1)
    expect(api.putActionLogDailyActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'daily_2026-04-16',
        summary: 'Lily noted a steady day of research and implementation.',
        questSummary: 'Quest summary based on same-day quest completions.',
        healthSummary: 'Health summary based on same-day health data.',
      }),
    )
    expect(generated.dailyLog?.summary).toBe('Lily noted a steady day of research and implementation.')
  })

  it('does not generate a DailyActivityLog for today even when it is missing', async () => {
    const state = hydratePersistedState()

    await ensurePreviousDayDailyActivityLog({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-17',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(ai.generateDailyActivityLogSummary).not.toHaveBeenCalled()
    expect(ai.generateDailyQuestSummary).not.toHaveBeenCalled()
    expect(ai.generateDailyHealthSummary).not.toHaveBeenCalled()
    expect(api.putActionLogDailyActivityLog).not.toHaveBeenCalled()
  })

  it('does not generate a DailyActivityLog for older days', async () => {
    const state = hydratePersistedState()

    await ensurePreviousDayDailyActivityLog({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-15',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(ai.generateDailyActivityLogSummary).not.toHaveBeenCalled()
    expect(ai.generateDailyQuestSummary).not.toHaveBeenCalled()
    expect(ai.generateDailyHealthSummary).not.toHaveBeenCalled()
    expect(api.putActionLogDailyActivityLog).not.toHaveBeenCalled()
  })

  it('generates a missing WeeklyActivityReview only on Monday for the previous week from the week screen', async () => {
    const state = hydratePersistedState()
    vi.mocked(ai.generateWeeklyActivityReview).mockResolvedValue({
      provider: 'template',
      summary: 'Lily observed a week centered on research and implementation.',
      focusThemes: ['Chrome docs', 'implementation'],
    })

    const generated = await ensurePreviousWeekReviewForWeb({
      aiConfig: state.aiConfig,
      settings: state.settings,
      routeScope: 'week',
      weekKey: '2026-W16',
      now: new Date('2026-04-20T09:00:00+09:00'),
    })

    expect(generated).toBe(true)
    expect(ai.generateWeeklyActivityReview).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ai.generateWeeklyActivityReview).mock.calls[0][0]).toMatchObject({
      weekKey: '2026-W16',
      categoryDurations: { study: 40, work: 20 },
    })
    expect(api.putActionLogWeeklyActivityReview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'weekly_2026-W16',
        weekKey: '2026-W16',
      }),
    )
  })

  it('does not generate a WeeklyActivityReview from the week screen for non-previous weeks', async () => {
    const state = hydratePersistedState()

    const generated = await ensurePreviousWeekReviewForWeb({
      aiConfig: state.aiConfig,
      settings: state.settings,
      routeScope: 'week',
      weekKey: '2026-W15',
      now: new Date('2026-04-20T09:00:00+09:00'),
    })

    expect(generated).toBe(false)
    expect(ai.generateWeeklyActivityReview).not.toHaveBeenCalled()
    expect(api.putActionLogWeeklyActivityReview).not.toHaveBeenCalled()
  })

  it('does not generate a WeeklyActivityReview from web screens after Monday', async () => {
    const state = hydratePersistedState()

    const generated = await ensurePreviousWeekReviewForWeb({
      aiConfig: state.aiConfig,
      settings: state.settings,
      routeScope: 'week',
      weekKey: '2026-W16',
      now: new Date('2026-04-21T09:00:00+09:00'),
    })

    expect(generated).toBe(false)
    expect(ai.generateWeeklyActivityReview).not.toHaveBeenCalled()
    expect(api.putActionLogWeeklyActivityReview).not.toHaveBeenCalled()
  })

  it('generates the missing previous-week review from the year screen only when the year matches', async () => {
    const state = hydratePersistedState()
    vi.mocked(ai.generateWeeklyActivityReview).mockResolvedValue({
      provider: 'template',
      summary: 'Lily tied the previous week together from the saved sessions.',
      focusThemes: ['Chrome docs'],
    })

    const generated = await ensurePreviousWeekReviewForWeb({
      aiConfig: state.aiConfig,
      settings: state.settings,
      routeScope: 'year',
      year: 2026,
      now: new Date('2026-04-20T09:00:00+09:00'),
    })

    expect(generated).toBe(true)
    expect(api.putActionLogWeeklyActivityReview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'weekly_2026-W16', weekKey: '2026-W16' }),
    )
  })

  it('does not generate the previous-week review from the year screen when the viewed year differs', async () => {
    const state = hydratePersistedState()

    const generated = await ensurePreviousWeekReviewForWeb({
      aiConfig: state.aiConfig,
      settings: state.settings,
      routeScope: 'year',
      year: 2025,
      now: new Date('2026-04-20T09:00:00+09:00'),
    })

    expect(generated).toBe(false)
    expect(ai.generateWeeklyActivityReview).not.toHaveBeenCalled()
    expect(api.putActionLogWeeklyActivityReview).not.toHaveBeenCalled()
  })

  it('resolves the latest available review year when the current year has no saved reviews', async () => {
    vi.mocked(api.getActionLogWeeklyActivityReviews).mockImplementation(async (year) => {
      if (year === 2026) {
        return []
      }
      if (year === 2025) {
        return [
          createWeeklyReview('2025-W52', {
            id: 'weekly_2025-W52',
            weekKey: '2025-W52',
            summary: 'Last saved review year.',
            generatedAt: '2025-12-29T08:00:00+09:00',
          }),
        ]
      }
      return []
    })

    const resolvedYear = await resolveDefaultReviewYearJst({
      currentYear: 2026,
      minYear: 2024,
    })

    expect(resolvedYear).toBe(2025)
    expect(api.getActionLogWeeklyActivityReviews).toHaveBeenNthCalledWith(1, 2026)
    expect(api.getActionLogWeeklyActivityReviews).toHaveBeenNthCalledWith(2, 2025)
  })

  it('falls back to the current year when no saved review year exists', async () => {
    vi.mocked(api.getActionLogWeeklyActivityReviews).mockResolvedValue([])

    const resolvedYear = await resolveDefaultReviewYearJst({
      currentYear: 2026,
      minYear: 2024,
    })

    expect(resolvedYear).toBe(2026)
    expect(api.getActionLogWeeklyActivityReviews).toHaveBeenNthCalledWith(1, 2026)
    expect(api.getActionLogWeeklyActivityReviews).toHaveBeenNthCalledWith(2, 2025)
    expect(api.getActionLogWeeklyActivityReviews).toHaveBeenNthCalledWith(3, 2024)
  })

  it('builds weekly app and domain usage summaries from session durations without double counting', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('multi_context', {
        dateKey: '2026-04-14',
        startedAt: '2026-04-14T09:00:00+09:00',
        endedAt: '2026-04-14T10:00:00+09:00',
        appNames: ['Chrome', 'Code'],
        domains: ['developer.chrome.com', 'github.com'],
      }),
      createSession('focused_chrome', {
        dateKey: '2026-04-15',
        startedAt: '2026-04-15T09:00:00+09:00',
        endedAt: '2026-04-15T09:30:00+09:00',
        appNames: ['Chrome'],
        domains: ['developer.chrome.com'],
      }),
    ])
    vi.mocked(api.getActionLogWeeklyActivityReview).mockResolvedValue(createWeeklyReview('2026-W16'))

    const result = await fetchActivityReviewWeek('2026-W16')

    expect(result.topApps).toEqual([
      { label: 'Chrome', minutes: 60 },
      { label: 'Code', minutes: 30 },
    ])
    expect(result.topDomains).toEqual([
      { label: 'developer.chrome.com', minutes: 60 },
      { label: 'github.com', minutes: 30 },
    ])
  })

  it('filters sessions by hidden/category/app/domain', async () => {
    vi.mocked(api.getActionLogSessions).mockResolvedValue([
      createSession('visible_chrome', {
        primaryCategory: 'study',
        appNames: ['Chrome'],
        domains: ['developer.chrome.com'],
        searchKeywords: ['chrome'],
        hidden: false,
      }),
      createSession('hidden_code', {
        primaryCategory: 'work',
        appNames: ['Code'],
        domains: [],
        searchKeywords: ['code'],
        hidden: true,
      }),
    ])
    const filtered = await searchActivityLogs({
      from: '2026-04-01',
      to: '2026-04-17',
      keyword: 'chrome',
      categories: ['study'],
      apps: ['Chrome'],
      domains: ['developer.chrome.com'],
      includeHidden: false,
    })

    expect(filtered.sessions.map((session) => session.id)).toEqual(['visible_chrome'])

    const withHidden = await searchActivityLogs({
      from: '2026-04-01',
      to: '2026-04-17',
      keyword: 'code',
      categories: [],
      apps: [],
      domains: [],
      includeHidden: true,
    })

    expect(withHidden.sessions.map((session) => session.id)).toEqual(['hidden_code'])
  })

  it('exports an action-log bundle with overlapping weekly reviews only', async () => {
    vi.mocked(api.getActionLogRawEvents).mockResolvedValue([createRawEvent('raw_1')])
    vi.mocked(api.getActionLogSessions).mockResolvedValue([createSession('session_1')])
    vi.mocked(api.getActionLogDailyActivityLogs).mockResolvedValue([createDailyLog('2026-04-16')])
    vi.mocked(api.getSituationLogs).mockResolvedValue([createSituationLog()])
    vi.mocked(api.getActionLogWeeklyActivityReviews).mockResolvedValue([
      createWeeklyReview('2026-W16'),
      createWeeklyReview('2026-W10', {
        id: 'weekly_2026-W10',
        summary: 'older week summary',
        generatedAt: '2026-03-10T08:00:00+09:00',
      }),
    ])

    const bundle = await exportActionLogBundle({
      from: '2026-04-14',
      to: '2026-04-18',
      now: new Date('2026-04-18T10:00:00+09:00'),
    })

    expect(bundle.rawEvents.map((event) => event.id)).toEqual(['raw_1'])
    expect(bundle.sessions.map((session) => session.id)).toEqual(['session_1'])
    expect(bundle.dailyLogs.map((log) => log.id)).toEqual(['daily_2026-04-16'])
    expect(bundle.situationLogs.map((log) => log.timestamp)).toEqual(['2026-04-16T18:30:00+09:00'])
    expect(bundle.weeklyReviews.map((review) => review.id)).toEqual(['weekly_2026-W16'])
    expect(bundle.meta).toMatchObject({
      from: '2026-04-14',
      to: '2026-04-18',
      timezone: 'Asia/Tokyo',
      exportedAt: '2026-04-18T10:00:00+09:00',
    })
  })

  it('allows delete only up to yesterday JST', () => {
    expect(
      canDeleteActionLogRange({
        from: '2026-04-10',
        to: '2026-04-16',
        now: new Date('2026-04-17T09:00:00+09:00'),
      }),
    ).toBe(true)

    expect(
      canDeleteActionLogRange({
        from: '2026-04-10',
        to: '2026-04-17',
        now: new Date('2026-04-17T09:00:00+09:00'),
      }),
    ).toBe(false)
  })

  it('deletes an action-log range and returns situation log counts too', async () => {
    const result = await deleteActionLogDateRange({
      from: '2026-04-10',
      to: '2026-04-16',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(api.deleteActionLogRange).toHaveBeenCalledWith('2026-04-10', '2026-04-16')
    expect(result.deleted.situationLogs).toBe(2)
  })

  it('updates a session hidden flag through the targeted API', async () => {
    const hiddenSession = await setActivitySessionHidden({
      sessionId: 'session_1',
      dateKey: '2026-04-16',
      hidden: true,
    })

    expect(api.putActionLogSessionHidden).toHaveBeenCalledWith('session_1', {
      dateKey: '2026-04-16',
      hidden: true,
    })
    expect(hiddenSession.hidden).toBe(true)
  })
})
