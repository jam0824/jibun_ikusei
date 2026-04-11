import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocal, setLocal } from '@ext/lib/storage'
import type { ClassificationCacheEntry } from '@ext/types/browsing'

const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
  {
    ok: true,
    json: () => Promise.resolve({
      output_text: JSON.stringify({
        category: '学習',
        isGrowth: true,
        confidence: 0.95,
        suggestedQuestTitle: 'プログラミング学習',
        suggestedSkill: 'TypeScript',
      }),
    }),
  } as Response
))
globalThis.fetch = fetchMock

describe('message-handler', () => {
  beforeEach(async () => {
    fetchMock.mockClear()
    vi.resetModules()
  })

  describe('handlePageInfo', () => {
    it('AI 分類を実行してタブ分類を保存する', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        openaiApiKey: 'test-key',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { handlePageInfo, getTabClassification } = await import('./message-handler')
      await handlePageInfo(1, {
        domain: 'developer.mozilla.org',
        url: 'https://developer.mozilla.org/docs/Web',
        title: 'MDN Web Docs',
      })

      const result = getTabClassification(1)
      expect(result).toBeDefined()
      expect(result!.category).toBe('学習')
      expect(result!.isGrowth).toBe(true)
      expect(result!.cacheKey).toBe('developer.mozilla.org:/docs/Web')
    })

    it('キャッシュヒット時は AI を呼ばない', async () => {
      const cacheKey = 'example.com:/page'
      const cacheStore: Record<string, ClassificationCacheEntry> = {
        [cacheKey]: {
          result: {
            category: '仕事',
            isGrowth: true,
            confidence: 0.9,
            suggestedQuestTitle: '仕事',
            suggestedSkill: 'マネジメント',
            cacheKey,
          },
          source: 'ai',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      }
      await setLocal('classificationCache', cacheStore)
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        openaiApiKey: 'test-key',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { handlePageInfo, getTabClassification } = await import('./message-handler')
      await handlePageInfo(2, {
        domain: 'example.com',
        url: 'https://example.com/page',
        title: 'Example',
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(getTabClassification(2)?.category).toBe('仕事')
    })

    it('API キー未設定時はフォールバック分類を返す', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { handlePageInfo, getTabClassification } = await import('./message-handler')
      await handlePageInfo(3, {
        domain: 'example.com',
        url: 'https://example.com/page',
        title: 'Example Page',
      })

      const result = getTabClassification(3)
      expect(result).toBeDefined()
      expect(result!.category).toBe('その他')
      expect(result!.isGrowth).toBe(false)
      expect(result!.confidence).toBe(0)
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
    })

    it('分類結果を classificationCache に保存する', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        openaiApiKey: 'test-key',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { handlePageInfo } = await import('./message-handler')
      await handlePageInfo(4, {
        domain: 'learn.com',
        url: 'https://learn.com/typescript',
        title: 'TypeScript Tutorial',
      })

      const cache = await getLocal<Record<string, ClassificationCacheEntry>>('classificationCache')
      expect(cache?.['learn.com:/typescript']).toBeDefined()
      expect(cache?.['learn.com:/typescript'].result.category).toBe('学習')
    })

    it('通知が有効なら分類トーストを送る', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        openaiApiKey: 'test-key',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { handlePageInfo } = await import('./message-handler')
      await handlePageInfo(5, {
        domain: 'developer.mozilla.org',
        url: 'https://developer.mozilla.org/docs/Web',
        title: 'MDN Web Docs',
      })

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          type: 'SHOW_TOAST',
          payload: expect.objectContaining({ variant: 'info' }),
        }),
      )
    })
  })

  describe('tab classifications', () => {
    it('未分類のタブ ID には undefined を返す', async () => {
      const { getTabClassification } = await import('./message-handler')
      expect(getTabClassification(999)).toBeUndefined()
    })

    it('clearTabClassification でメモリ上の分類を消す', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { clearTabClassification, getTabClassification, handlePageInfo } = await import('./message-handler')
      await handlePageInfo(6, {
        domain: 'example.com',
        url: 'https://example.com/',
        title: 'Example',
      })

      expect(getTabClassification(6)).toBeDefined()
      clearTabClassification(6)
      expect(getTabClassification(6)).toBeUndefined()
    })
  })

  describe('setupMessageListener', () => {
    it('chrome.runtime.onMessage.addListener を登録する', async () => {
      const { setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled()
    })

    it('PAGE_INFO メッセージで handlePageInfo を呼ぶ', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        openaiApiKey: 'test-key',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { getTabClassification, setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0]

      callback(
        { type: 'PAGE_INFO', payload: { domain: 'test.com', url: 'https://test.com/', title: 'Test' } },
        { tab: { id: 10 } } as chrome.runtime.MessageSender,
        () => {},
      )

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(getTabClassification(10)).toBeDefined()
    })

    it('OPEN_POPUP メッセージで popup を開く', async () => {
      const { setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0]

      callback({ type: 'OPEN_POPUP' }, {} as chrome.runtime.MessageSender, () => {})

      expect(chrome.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('popup.html') }),
      )
    })

    it('ENSURE_TODAY_PROGRESS で当日進捗を初期化して ok を返す', async () => {
      const { setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0]

      const response = await new Promise<unknown>((resolve) => {
        const keepAlive = callback(
          { type: 'ENSURE_TODAY_PROGRESS' },
          {} as chrome.runtime.MessageSender,
          resolve,
        )
        expect(keepAlive).toBe(true)
      })

      expect(response).toEqual({ ok: true })
      expect(await getLocal('dailyProgress')).toBeDefined()
    })

    it('CLEAR_SYNC_STATE で未同期状態だけを消す', async () => {
      await setLocal('dailyProgress', { date: '2026-03-30' })
      await setLocal('dailyProgressHistory', [{ date: '2026-03-29' }])
      await setLocal('syncQueue', [{ path: '/quests', method: 'POST', body: {} }])
      await setLocal('activityLogBuffer', [{ action: 'test' }])
      await setLocal('browsingTimeSyncBacklog', { '2026-03-29': { date: '2026-03-29', domains: {}, totalSeconds: 0 } })
      await setLocal('weeklyReport', { weekKey: '2026-W13' })
      await setLocal('classificationCache', { persisted: { result: {}, source: 'manual' } })

      const { setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0]

      const response = await new Promise<unknown>((resolve) => {
        callback({ type: 'CLEAR_SYNC_STATE' }, {} as chrome.runtime.MessageSender, resolve)
      })

      expect(response).toEqual({ ok: true })
      expect(await getLocal('dailyProgress')).toBeUndefined()
      expect(await getLocal('dailyProgressHistory')).toBeUndefined()
      expect(await getLocal('syncQueue')).toBeUndefined()
      expect(await getLocal('activityLogBuffer')).toBeUndefined()
      expect(await getLocal('browsingTimeSyncBacklog')).toBeUndefined()
      expect(await getLocal('weeklyReport')).toBeUndefined()
      expect(await getLocal('classificationCache')).toBeDefined()
    })

    it('RESET_EXTENSION_DATA で classificationCache も含めて消す', async () => {
      await setLocal('dailyProgress', { date: '2026-03-30' })
      await setLocal('classificationCache', { persisted: { result: {}, source: 'manual' } })

      const { setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0]

      const response = await new Promise<unknown>((resolve) => {
        callback({ type: 'RESET_EXTENSION_DATA' }, {} as chrome.runtime.MessageSender, resolve)
      })

      expect(response).toEqual({ ok: true })
      expect(await getLocal('dailyProgress')).toBeUndefined()
      expect(await getLocal('classificationCache')).toBeUndefined()
    })

    it('manual 修正で tabClassifications を更新する', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        openaiApiKey: 'test-key',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { getTabClassification, handlePageInfo, setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      await handlePageInfo(11, {
        domain: 'game.com',
        url: 'https://game.com/play',
        title: 'Game',
      })

      const before = getTabClassification(11)
      expect(before).toBeDefined()

      const storageListener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0] as (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        areaName: string,
      ) => void

      storageListener({
        classificationCache: {
          newValue: {
            [before!.cacheKey]: {
              result: { ...before!, category: '学習', isGrowth: true },
              source: 'manual',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          },
        },
      }, 'local')

      expect(getTabClassification(11)?.category).toBe('学習')
      expect(getTabClassification(11)?.isGrowth).toBe(true)
    })

    it('classificationCache が削除されたら tabClassifications もクリアする', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { getTabClassification, handlePageInfo, setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      await handlePageInfo(12, {
        domain: 'example.com',
        url: 'https://example.com/',
        title: 'Example',
      })

      expect(getTabClassification(12)).toBeDefined()

      const storageListener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0] as (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        areaName: string,
      ) => void

      storageListener({
        classificationCache: {
          oldValue: {},
          newValue: undefined,
        },
      }, 'local')

      expect(getTabClassification(12)).toBeUndefined()
    })
  })
})
