import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActivitySession,
  DailyActivityLog,
  OpenLoop,
  RawEvent,
  WeeklyActivityReview,
} from '@/domain/action-log-types'
import { hydratePersistedState } from '@/domain/logic'

vi.mock('@/lib/api-client', () => ({
  getActionLogDailyActivityLog: vi.fn(),
  getActionLogOpenLoops: vi.fn(),
  getActionLogRawEvents: vi.fn(),
  getActionLogSessions: vi.fn(),
  getActionLogWeeklyActivityReview: vi.fn(),
  putActionLogDailyActivityLog: vi.fn(),
  putActionLogWeeklyActivityReview: vi.fn(),
  getActionLogDailyActivityLogs: vi.fn(),
  getActionLogWeeklyActivityReviews: vi.fn(),
}))

vi.mock('@/lib/ai', () => ({
  generateDailyActivityLog: vi.fn(),
  generateWeeklyActivityReview: vi.fn(),
}))

import * as api from '@/lib/api-client'
import * as ai from '@/lib/ai'
import {
  ensurePreviousDayDailyActivityLog,
  ensurePreviousWeekReviewForWeb,
} from '@/lib/action-log-view'

function createSession(id: string, overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id,
    deviceId: 'device_main',
    startedAt: '2026-04-16T09:00:00+09:00',
    endedAt: '2026-04-16T09:40:00+09:00',
    dateKey: '2026-04-16',
    title: 'Chrome 拡張の調査',
    primaryCategory: '学習',
    activityKinds: ['調査'],
    appNames: ['Chrome'],
    domains: ['developer.chrome.com'],
    projectNames: [],
    summary: 'Chrome 拡張まわりを調査していた。',
    searchKeywords: ['Chrome拡張', 'developer.chrome.com'],
    noteIds: [],
    openLoopIds: ['open_loop_1'],
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

function createOpenLoop(id = 'open_loop_1', overrides: Partial<OpenLoop> = {}): OpenLoop {
  return {
    id,
    createdAt: '2026-04-16T09:40:00+09:00',
    updatedAt: '2026-04-16T09:40:00+09:00',
    dateKey: '2026-04-16',
    title: '権限設定の確認',
    description: 'manifest の権限設定を確認する。',
    status: 'open',
    linkedSessionIds: ['session_1'],
    ...overrides,
  }
}

function createDailyLog(dateKey = '2026-04-16', overrides: Partial<DailyActivityLog> = {}): DailyActivityLog {
  return {
    id: `daily_${dateKey}`,
    dateKey,
    summary: 'リリィは、この日は拡張の調査へ静かな集中が集まっていたと見ている。',
    mainThemes: ['Chrome拡張', '調査'],
    noteIds: [],
    openLoopIds: ['open_loop_1'],
    reviewQuestions: ['次に確認したい仕様はどこだったか。'],
    generatedAt: `${dateKey}T22:00:00+09:00`,
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
        title: 'VS Code での実装',
        primaryCategory: '仕事',
        activityKinds: ['開発'],
        appNames: ['Code'],
        domains: [],
        searchKeywords: ['VS Code', '開発'],
        openLoopIds: [],
      }),
    ])
    vi.mocked(api.getActionLogRawEvents).mockResolvedValue([createRawEvent('event_1')])
    vi.mocked(api.getActionLogDailyActivityLog).mockResolvedValue(null)
    vi.mocked(api.getActionLogOpenLoops).mockResolvedValue([createOpenLoop()])
    vi.mocked(api.getActionLogWeeklyActivityReview).mockResolvedValue(null)
    vi.mocked(api.putActionLogDailyActivityLog).mockImplementation(async (log) => log)
    vi.mocked(api.putActionLogWeeklyActivityReview).mockImplementation(async (review) => review)
  })

  it('generates and saves a missing DailyActivityLog only for yesterday using ActivitySession input', async () => {
    const state = hydratePersistedState()
    vi.mocked(ai.generateDailyActivityLog).mockResolvedValue({
      provider: 'template',
      summary: 'リリィは、前日の調査の流れをひとつのまとまりとして見ていた。',
      mainThemes: ['Chrome拡張', '調査'],
      reviewQuestions: ['次に確認したい仕様はどこだったか。'],
    })

    const result = await ensurePreviousDayDailyActivityLog({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-16',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(ai.generateDailyActivityLog).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ai.generateDailyActivityLog).mock.calls[0][0]).toMatchObject({
      dateKey: '2026-04-16',
      sessions: [createSession('session_1')],
      openLoops: [createOpenLoop()],
    })
    expect(vi.mocked(ai.generateDailyActivityLog).mock.calls[0][0]).not.toHaveProperty('rawEvents')
    expect(api.putActionLogDailyActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'daily_2026-04-16',
        dateKey: '2026-04-16',
        openLoopIds: ['open_loop_1'],
      }),
    )
    expect(result.dailyLog?.summary).toBe('リリィは、前日の調査の流れをひとつのまとまりとして見ていた。')
  })

  it('does not generate a DailyActivityLog for today even when it is missing', async () => {
    const state = hydratePersistedState()

    await ensurePreviousDayDailyActivityLog({
      aiConfig: state.aiConfig,
      settings: state.settings,
      dateKey: '2026-04-17',
      now: new Date('2026-04-17T09:00:00+09:00'),
    })

    expect(ai.generateDailyActivityLog).not.toHaveBeenCalled()
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

    expect(ai.generateDailyActivityLog).not.toHaveBeenCalled()
    expect(api.putActionLogDailyActivityLog).not.toHaveBeenCalled()
  })

  it('generates a missing WeeklyActivityReview only on Monday for the previous week from the week screen', async () => {
    const state = hydratePersistedState()
    vi.mocked(ai.generateWeeklyActivityReview).mockResolvedValue({
      provider: 'template',
      summary: 'リリィは、この週には調査と実装の往復がゆっくり深まっていたと見ている。',
      focusThemes: ['Chrome拡張', '開発'],
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
      openLoops: [createOpenLoop()],
      categoryDurations: { 学習: 40, 仕事: 20 },
    })
    expect(api.putActionLogWeeklyActivityReview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'weekly_2026-W16',
        weekKey: '2026-W16',
        openLoopIds: ['open_loop_1'],
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
      summary: 'リリィは、この週のまとまりを静かに見返している。',
      focusThemes: ['Chrome拡張'],
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
})
