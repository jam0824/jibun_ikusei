import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setLocal } from '@ext/lib/storage'
import { createMockDailyProgress, createMockAuthState } from '@ext/test/helpers'
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
    it('good_questイベントでQuest+CompletionをPOSTする', async () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        lastGoodRewardAtSeconds: 0,
        domainTimes: {
          'docs.example.com:/api': {
            domain: 'docs.example.com',
            cacheKey: 'docs.example.com:/api',
            category: '学習',
            isGrowth: true,
            isBlocklisted: false,
            totalSeconds: 30 * 60,
            lastUpdated: '',
          },
        },
      })
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', { serverBaseUrl: 'https://test.example.com', syncEnabled: true })
      await setLocal('authState', createMockAuthState())
      // 分類キャッシュをセット
      await setLocal('classificationCache', {
        'docs.example.com:/api': {
          result: {
            category: '学習',
            isGrowth: true,
            confidence: 0.9,
            suggestedQuestTitle: 'API設計ドキュメントの学習',
            suggestedSkill: 'API設計',
            cacheKey: 'docs.example.com:/api',
          },
          source: 'ai',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      // POST /quests が呼ばれたことを確認
      const questCalls = fetchMock.mock.calls.filter(
        (call) => {
          const url = call[0] as string
          const opts = call[1] as RequestInit | undefined
          return url.includes('/quests') && opts?.method === 'POST'
        },
      )
      expect(questCalls.length).toBeGreaterThanOrEqual(1)
      const questBody = JSON.parse(questCalls[0][1]!.body as string)
      expect(questBody.title).toBe('API設計ドキュメントの学習')
      expect(questBody.source).toBe('browsing')
      expect(questBody.browsingType).toBe('good')
      expect(questBody.xpReward).toBe(BROWSING_XP.GOOD_REWARD)
      expect(questBody.domain).toBe('docs.example.com')

      // POST /completions が呼ばれたことを確認
      const completionCalls = fetchMock.mock.calls.filter(
        (call) => {
          const url = call[0] as string
          const opts = call[1] as RequestInit | undefined
          return url.includes('/completions') && opts?.method === 'POST'
        },
      )
      expect(completionCalls.length).toBeGreaterThanOrEqual(1)
      const compBody = JSON.parse(completionCalls[0][1]!.body as string)
      expect(compBody.userXpAwarded).toBe(BROWSING_XP.GOOD_REWARD)
      expect(compBody.questId).toBe(questBody.id)
    })

    it('bad_questイベントでQuest+CompletionをPOSTする', async () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 60 * 60,
        lastBadPenaltyAtSeconds: 0,
        domainTimes: {
          'game.com:/play': {
            domain: 'game.com',
            cacheKey: 'game.com:/play',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 60 * 60,
            lastUpdated: '',
          },
        },
      })
      await setLocal('dailyProgress', progress)
      await setLocal('extensionSettings', { serverBaseUrl: 'https://test.example.com', syncEnabled: true })
      await setLocal('authState', createMockAuthState())

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'periodic-sync', scheduledTime: Date.now() })

      // POST /quests が呼ばれたことを確認
      const questCalls = fetchMock.mock.calls.filter(
        (call) => {
          const url = call[0] as string
          const opts = call[1] as RequestInit | undefined
          return url.includes('/quests') && opts?.method === 'POST'
        },
      )
      expect(questCalls.length).toBeGreaterThanOrEqual(1)
      const questBody = JSON.parse(questCalls[0][1]!.body as string)
      expect(questBody.source).toBe('browsing')
      expect(questBody.browsingType).toBe('bad')
      expect(questBody.xpReward).toBe(-BROWSING_XP.BAD_PENALTY)

      // POST /completions が呼ばれたことを確認
      const completionCalls = fetchMock.mock.calls.filter(
        (call) => {
          const url = call[0] as string
          const opts = call[1] as RequestInit | undefined
          return url.includes('/completions') && opts?.method === 'POST'
        },
      )
      expect(completionCalls.length).toBeGreaterThanOrEqual(1)
      const compBody = JSON.parse(completionCalls[0][1]!.body as string)
      expect(compBody.userXpAwarded).toBe(-BROWSING_XP.BAD_PENALTY)
      expect(compBody.questId).toBe(questBody.id)
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
      await setLocal('authState', createMockAuthState())

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

    it('ログインしていない場合はAPIを呼び出さない', async () => {
      await setLocal('syncQueue', [
        { path: '/completions', method: 'POST', body: { userXpAwarded: 5 }, enqueuedAt: '2026-01-01' },
      ])
      await setLocal('dailyProgress', createMockDailyProgress())
      await setLocal('extensionSettings', {
        serverBaseUrl: 'https://test.example.com',
        syncEnabled: true,
      })
      // authStateを設定しない → 未ログイン状態

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
      await setLocal('authState', createMockAuthState())

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
    it('periodic-sync、daily-reset-check、weekly-report-genアラームを作成する', async () => {
      const { setupAlarms } = await import('./alarm-handlers')
      setupAlarms()

      expect(chrome.alarms.create).toHaveBeenCalledWith('periodic-sync', { periodInMinutes: 5 })
      expect(chrome.alarms.create).toHaveBeenCalledWith('daily-reset-check', { periodInMinutes: 1 })
      expect(chrome.alarms.create).toHaveBeenCalledWith('weekly-report-gen', { periodInMinutes: 60 })
    })
  })

  describe('weekly-report-gen', () => {
    it('月曜日に週次レポートを生成してストレージに保存する', async () => {
      // 月曜日をシミュレート (2026-03-23 は月曜日)
      vi.spyOn(Date.prototype, 'getDay').mockReturnValue(1)

      const history = [
        createMockDailyProgress({
          date: '2026-03-16',
          goodBrowsingSeconds: 60 * 60,
          badBrowsingSeconds: 30 * 60,
          goodQuestsCleared: 2,
        }),
      ]
      await setLocal('dailyProgressHistory', history)

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'weekly-report-gen', scheduledTime: Date.now() })

      const stored = await chrome.storage.local.get('weeklyReport')
      expect(stored.weeklyReport).toBeDefined()
      expect(stored.weeklyReport.goodMinutes).toBe(60)
      expect(stored.weeklyReport.badMinutes).toBe(30)
    })

    it('同じweekKeyのレポートが既に存在する場合はスキップする', async () => {
      vi.spyOn(Date.prototype, 'getDay').mockReturnValue(1)

      const history = [
        createMockDailyProgress({
          date: '2026-03-16',
          goodBrowsingSeconds: 60 * 60,
        }),
      ]
      await setLocal('dailyProgressHistory', history)

      // 既存レポートをセット（同じweekKey）
      const now = new Date()
      const jan1 = new Date(now.getFullYear(), 0, 1)
      const days = Math.floor((now.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000))
      const weekNum = Math.ceil((days + jan1.getDay() + 1) / 7)
      const weekKey = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`

      await chrome.storage.local.set({
        weeklyReport: {
          weekKey,
          totalMinutes: 100,
          goodMinutes: 50,
          badMinutes: 50,
          categoryBreakdown: {},
          topGrowthDomains: [],
          goodQuestsCleared: 1,
          badQuestsTriggered: 0,
          lilyComment: '既存レポート',
          generatedAt: new Date().toISOString(),
        },
      })

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'weekly-report-gen', scheduledTime: Date.now() })

      // 既存のレポートが上書きされていないこと
      const stored = await chrome.storage.local.get('weeklyReport')
      expect(stored.weeklyReport.lilyComment).toBe('既存レポート')
    })

    it('月曜日以外はレポートを生成しない', async () => {
      // 火曜日
      vi.spyOn(Date.prototype, 'getDay').mockReturnValue(2)

      const { handleAlarm } = await import('./alarm-handlers')
      await handleAlarm({ name: 'weekly-report-gen', scheduledTime: Date.now() })

      const stored = await chrome.storage.local.get('weeklyReport')
      expect(stored.weeklyReport).toBeUndefined()
    })
  })
})
