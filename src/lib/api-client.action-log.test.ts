import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getIdToken: vi.fn().mockResolvedValue('test-token'),
}))

import {
  deleteActionLogRange,
  getActionLogDailyActivityLogs,
  getActionLogDailyActivityLog,
  getActionLogDeletionRequests,
  getActionLogDevices,
  getActionLogPrivacyRules,
  getActionLogRawEvents,
  getActionLogSessions,
  getActionLogWeeklyActivityReviews,
  getActionLogWeeklyActivityReview,
  getActivityLogs,
  postActionLogRawEvents,
  postActivityLogs,
  postActionLogDeletionRequestAck,
  putActionLogDailyActivityLog,
  putActionLogDevice,
  putActionLogPrivacyRules,
  putActionLogSessionHidden,
  putActionLogSessions,
  putActionLogWeeklyActivityReview,
} from './api-client'

const fetchMock = vi.fn<
  (input: string, init?: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }>
>()

describe('api-client action-log stubs', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '{}',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('posts raw events to /action-log/raw-events with a wrapper body', async () => {
    await postActionLogRawEvents({
      deviceId: 'device_1',
      events: [
        {
          id: 'raw_1',
          deviceId: 'device_1',
          source: 'desktop_agent',
          eventType: 'active_window_changed',
          occurredAt: '2026-04-17T09:15:00+09:00',
          expiresAt: '2026-05-17T09:15:00+09:00',
        },
      ],
    })

    const [path, init] = fetchMock.mock.calls[0] ?? []
    expect(path).toEqual(expect.stringContaining('/action-log/raw-events'))
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      deviceId: 'device_1',
      events: [
        {
          id: 'raw_1',
          deviceId: 'device_1',
          source: 'desktop_agent',
          eventType: 'active_window_changed',
          occurredAt: '2026-04-17T09:15:00+09:00',
          expiresAt: '2026-05-17T09:15:00+09:00',
        },
      ],
    })
  })

  it('puts sessions to /action-log/sessions with a wrapper body', async () => {
    await putActionLogSessions({
      deviceId: 'device_1',
      dateKeys: ['2026-04-16', '2026-04-17'],
      sessions: [
        {
          id: 'session_1',
          deviceId: 'device_1',
          startedAt: '2026-04-17T10:00:00+09:00',
          endedAt: '2026-04-17T10:45:00+09:00',
          dateKey: '2026-04-17',
          title: 'Chrome拡張の調査',
          primaryCategory: '仕事',
          activityKinds: ['research'],
          appNames: ['Chrome'],
          domains: ['developer.chrome.com'],
          projectNames: ['self-growth-app'],
          searchKeywords: ['Chrome extension', 'developer.chrome.com'],
          noteIds: [],
          hidden: false,
        },
      ],
    })

    const [path, init] = fetchMock.mock.calls[0] ?? []
    expect(path).toEqual(expect.stringContaining('/action-log/sessions'))
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      deviceId: 'device_1',
      dateKeys: ['2026-04-16', '2026-04-17'],
      sessions: [
        {
          id: 'session_1',
          deviceId: 'device_1',
          startedAt: '2026-04-17T10:00:00+09:00',
          endedAt: '2026-04-17T10:45:00+09:00',
          dateKey: '2026-04-17',
          title: 'Chrome拡張の調査',
          primaryCategory: '仕事',
          activityKinds: ['research'],
          appNames: ['Chrome'],
          domains: ['developer.chrome.com'],
          projectNames: ['self-growth-app'],
          searchKeywords: ['Chrome extension', 'developer.chrome.com'],
          noteIds: [],
          hidden: false,
        },
      ],
    })
  })

  it('uses the expected action-log read and write paths', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input)
      if (path.includes('/action-log/daily?')) {
        return {
          ok: true,
          text: async () => '[]',
        }
      }
      if (path.includes('/action-log/daily/2026-04-17') && !path.includes('/action-log/daily?')) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              id: 'daily_1',
              dateKey: '2026-04-17',
              summary: 'summary',
              questSummary: 'quest summary',
              healthSummary: 'health summary',
              mainThemes: ['調査'],
              noteIds: [],
              reviewQuestions: ['q1'],
              generatedAt: '2026-04-17T23:59:00+09:00',
            }),
        }
      }
      return {
        ok: true,
        text: async () => '{}',
      }
    })

    await getActionLogRawEvents('2026-04-01', '2026-04-17')
    await getActionLogSessions('2026-04-01', '2026-04-17')
    await getActionLogDailyActivityLogs('2026-04-01', '2026-04-17')
    await getActionLogDailyActivityLog('2026-04-17')
    await putActionLogDailyActivityLog({
      id: 'daily_1',
      dateKey: '2026-04-17',
      summary: 'summary',
      questSummary: 'quest summary',
      healthSummary: 'health summary',
      mainThemes: ['調査'],
      noteIds: [],
      reviewQuestions: ['q1'],
      generatedAt: '2026-04-17T23:59:00+09:00',
    })
    await getActionLogWeeklyActivityReviews(2026)
    await getActionLogWeeklyActivityReview('2026-W16')
    await putActionLogWeeklyActivityReview({
      id: 'weekly_1',
      weekKey: '2026-W16',
      summary: 'summary',
      categoryDurations: { 仕事: 120 },
      focusThemes: ['実装'],
      generatedAt: '2026-04-17T23:59:00+09:00',
    })
    await getActionLogDevices()
    await putActionLogDevice('device_1', { name: 'main-pc' })
    await getActionLogPrivacyRules()
    await putActionLogPrivacyRules([
      {
        id: 'rule_1',
        type: 'storage_mode',
        value: '*',
        mode: 'domain_only',
        enabled: true,
      },
    ])
    await putActionLogSessionHidden('session_1', {
      dateKey: '2026-04-17',
      hidden: true,
    })
    await deleteActionLogRange('2026-04-01', '2026-04-17')
    await getActionLogDeletionRequests()
    await postActionLogDeletionRequestAck('delete_1')

    const calledPaths = fetchMock.mock.calls.map(([input]) => input)
    expect(calledPaths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/action-log/raw-events?from=2026-04-01&to=2026-04-17'),
        expect.stringContaining('/action-log/sessions?from=2026-04-01&to=2026-04-17'),
        expect.stringContaining('/action-log/daily?from=2026-04-01&to=2026-04-17'),
        expect.stringContaining('/action-log/daily/2026-04-17'),
        expect.stringContaining('/action-log/daily/2026-04-17'),
        expect.stringContaining('/action-log/weekly?year=2026'),
        expect.stringContaining('/action-log/weekly/2026-W16'),
        expect.stringContaining('/action-log/weekly/2026-W16'),
        expect.stringContaining('/action-log/devices'),
        expect.stringContaining('/action-log/devices/device_1'),
        expect.stringContaining('/action-log/privacy-rules'),
        expect.stringContaining('/action-log/privacy-rules'),
        expect.stringContaining('/action-log/sessions/session_1/hidden'),
        expect.stringContaining('/action-log/range?from=2026-04-01&to=2026-04-17'),
        expect.stringContaining('/action-log/deletion-requests'),
        expect.stringContaining('/action-log/deletion-requests/delete_1/ack'),
      ]),
    )
  })

  it('keeps the legacy activity_logs contract unchanged', async () => {
    await postActivityLogs([
      {
        timestamp: '2026-04-17T09:15:00+09:00',
        source: 'web',
        action: 'quest.create',
        category: 'quest',
        details: { questId: 'q1' },
      },
    ])
    await getActivityLogs('2026-04-01', '2026-04-17')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/activity-logs'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          entries: [
            {
              timestamp: '2026-04-17T09:15:00+09:00',
              source: 'web',
              action: 'quest.create',
              category: 'quest',
              details: { questId: 'q1' },
            },
          ],
        }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/activity-logs?from=2026-04-01&to=2026-04-17'),
      expect.anything(),
    )
  })
})
