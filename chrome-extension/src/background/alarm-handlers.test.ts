import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setLocal } from '@ext/lib/storage'
import { createMockDailyProgress } from '@ext/test/helpers'
import { BROWSING_XP } from '@ext/types/browsing'

// Mock fetch for API calls — track request bodies
const fetchMock = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response),
)
globalThis.fetch = fetchMock

describe('alarm-handlers', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  describe('handlePeriodicSync', () => {
    it('evaluateProgressを呼んでgood_questをPOST /completionsで送信する', async () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        lastGoodRewardAtSeconds: 0,
      })
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', { serverBaseUrl: 'https://test.example.com', syncEnabled: true })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      // replayで POST /completions が呼ばれたことを確認
      const postCalls = fetchMock.mock.calls.filter(
        (call) => {
          const url = call[0] as string
          const opts = call[1] as RequestInit | undefined
          return url.includes('/completions') && opts?.method === 'POST'
        },
      )
      expect(postCalls.length).toBeGreaterThanOrEqual(1)

      const body = JSON.parse(postCalls[0][1]!.body as string)
      expect(body.userXpAwarded).toBe(BROWSING_XP.GOOD_REWARD)
      expect(body.type).toBe('good_quest')
    })

    it('bad_questイベントでXPペナルティをPOSTする', async () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 60 * 60,
        lastBadPenaltyAtSeconds: 0,
      })
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', { serverBaseUrl: 'https://test.example.com', syncEnabled: true })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      const postCalls = fetchMock.mock.calls.filter(
        (call) => {
          const url = call[0] as string
          const opts = call[1] as RequestInit | undefined
          return url.includes('/completions') && opts?.method === 'POST'
        },
      )
      expect(postCalls.length).toBeGreaterThanOrEqual(1)

      const body = JSON.parse(postCalls[0][1]!.body as string)
      expect(body.userXpAwarded).toBe(-BROWSING_XP.BAD_PENALTY)
      expect(body.type).toBe('bad_quest')
    })

    it('イベントがない場合はPOSTしない', async () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 0,
        badBrowsingSeconds: 0,
      })
      await setLocal('dailyProgress', progress)

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      const postCalls = fetchMock.mock.calls.filter(
        (call) => {
          const url = call[0] as string
          const opts = call[1] as RequestInit | undefined
          return url.includes('/completions') && opts?.method === 'POST'
        },
      )
      expect(postCalls).toHaveLength(0)
    })

    it('good_questイベント後にlastGoodRewardAtSecondsを更新する', async () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        lastGoodRewardAtSeconds: 0,
      })
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', { serverBaseUrl: 'https://test.example.com', syncEnabled: true })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      const { getLocal: gl } = await import('@ext/lib/storage')
      const updated = await gl<{ lastGoodRewardAtSeconds: number }>('dailyProgress')
      expect(updated!.lastGoodRewardAtSeconds).toBe(30 * 60)
    })

    it('bad_questイベント後にlastBadPenaltyAtSecondsを更新する', async () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 60 * 60,
        lastBadPenaltyAtSeconds: 0,
      })
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', { serverBaseUrl: 'https://test.example.com', syncEnabled: true })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      const { getLocal: gl } = await import('@ext/lib/storage')
      const updated = await gl<{ lastBadPenaltyAtSeconds: number }>('dailyProgress')
      expect(updated!.lastBadPenaltyAtSeconds).toBe(60 * 60)
    })

    it('warningイベント後にwarningShownDomainsを更新する', async () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 50 * 60,
        domainTimes: {
          'game.com:/': {
            domain: 'game.com',
            cacheKey: 'game.com:/',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 50 * 60,
            lastUpdated: '',
          },
        },
      })
      await setLocal('dailyProgress', progress)

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      const { getLocal: gl } = await import('@ext/lib/storage')
      const updated = await gl<{ warningShownDomains: string[] }>('dailyProgress')
      expect(updated!.warningShownDomains).toContain('game.com')
    })

    it('既存のSyncQueueエントリもreplayする', async () => {
      await setLocal('syncQueue', [
        { path: '/completions', method: 'POST', body: { userXpAwarded: 5 }, enqueuedAt: '2026-01-01' },
      ])
      const progress = createMockDailyProgress()
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', {
        serverBaseUrl: 'https://test.example.com',
        syncEnabled: true,
      })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      expect(fetchMock).toHaveBeenCalled()
    })
  })

  describe('syncEnabledガード', () => {
    it('syncEnabledがfalseの場合はreplayをスキップする', async () => {
      await setLocal('syncQueue', [
        { path: '/completions', method: 'POST', body: { userXpAwarded: 5 }, enqueuedAt: '2026-01-01' },
      ])
      await setLocal('dailyProgress', createMockDailyProgress())
      await setLocal('extensionSettings', {
        serverBaseUrl: 'https://test.example.com',
        syncEnabled: false,
      })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('serverBaseUrlが空の場合はreplayをスキップする', async () => {
      await setLocal('syncQueue', [
        { path: '/completions', method: 'POST', body: { userXpAwarded: 5 }, enqueuedAt: '2026-01-01' },
      ])
      await setLocal('dailyProgress', createMockDailyProgress())
      await setLocal('extensionSettings', {
        serverBaseUrl: '',
        syncEnabled: true,
      })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('syncEnabledがtrueでserverBaseUrlがある場合はreplayを実行する', async () => {
      await setLocal('syncQueue', [
        { path: '/completions', method: 'POST', body: { userXpAwarded: 5 }, enqueuedAt: '2026-01-01' },
      ])
      await setLocal('dailyProgress', createMockDailyProgress())
      await setLocal('extensionSettings', {
        serverBaseUrl: 'https://test.example.com',
        syncEnabled: true,
      })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      expect(fetchMock).toHaveBeenCalled()
    })

    it('syncEnabledがfalseでもevaluateAndEnqueueは実行する', async () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        lastGoodRewardAtSeconds: 0,
      })
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', {
        serverBaseUrl: 'https://test.example.com',
        syncEnabled: false,
      })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      // DailyProgressが更新されている = evaluateAndEnqueueは実行された
      const { getLocal: gl } = await import('@ext/lib/storage')
      const updated = await gl<{ lastGoodRewardAtSeconds: number }>('dailyProgress')
      expect(updated!.lastGoodRewardAtSeconds).toBe(30 * 60)
    })
  })

  describe('トースト通知', () => {
    it('good_questイベント発生時にトースト通知を送信する', async () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        lastGoodRewardAtSeconds: 0,
      })
      await setLocal('dailyProgress', progress)
      // アクティブタブを返すようモック
      vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
        { id: 1, url: 'https://example.com' } as chrome.tabs.Tab,
      ])

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: 'SHOW_TOAST',
          payload: expect.objectContaining({ variant: 'good' }),
        }),
      )
    })

    it('warningイベント発生時にトースト通知を送信する', async () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 50 * 60,
        domainTimes: {
          'game.com:/': {
            domain: 'game.com',
            cacheKey: 'game.com:/',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 50 * 60,
            lastUpdated: '',
          },
        },
      })
      await setLocal('dailyProgress', progress)
      vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
        { id: 1, url: 'https://game.com' } as chrome.tabs.Tab,
      ])

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: 'SHOW_TOAST',
          payload: expect.objectContaining({ variant: 'warning' }),
        }),
      )
    })

    it('notificationsEnabledがfalseの場合はトーストを送信しない', async () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        lastGoodRewardAtSeconds: 0,
      })
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', { notificationsEnabled: false })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
    })

    it('トースト送信が失敗してもevaluateAndEnqueueは完了する', async () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        lastGoodRewardAtSeconds: 0,
      })
      await setLocal('dailyProgress', progress)
      // tabs.query が例外を投げるケース
      vi.mocked(chrome.tabs.query).mockRejectedValueOnce(new Error('No active tab'))

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      // DailyProgressは更新されている
      const { getLocal: gl } = await import('@ext/lib/storage')
      const updated = await gl<{ lastGoodRewardAtSeconds: number }>('dailyProgress')
      expect(updated!.lastGoodRewardAtSeconds).toBe(30 * 60)
    })
  })

  describe('setupAlarms', () => {
    it('periodic-syncとdaily-reset-checkアラームを作成する', async () => {
      const { setupAlarms } = await import('./alarm-handlers')
      setupAlarms()

      expect(chrome.alarms.create).toHaveBeenCalledWith('periodic-sync', { periodInMinutes: 5 })
      expect(chrome.alarms.create).toHaveBeenCalledWith('daily-reset-check', { periodInMinutes: 1 })
    })
  })
})
