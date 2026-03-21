import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setLocal, getLocal } from '@ext/lib/storage'
import type { ClassificationCacheEntry } from '@ext/types/browsing'

// Mock fetch for AI classifier
const fetchMock = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        output_text: JSON.stringify({
          category: '学習',
          isGrowth: true,
          confidence: 0.95,
          suggestedQuestTitle: 'プログラミング学習',
          suggestedSkill: 'TypeScript',
        }),
      }),
  } as Response),
)
globalThis.fetch = fetchMock

describe('message-handler', () => {
  beforeEach(async () => {
    fetchMock.mockClear()
    // Reset module state by re-importing (clear tabClassifications Map)
    vi.resetModules()
  })

  describe('handlePageInfo', () => {
    it('PAGE_INFO受信時にAI分類を実行してタブに紐づける', async () => {
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

    it('キャッシュにヒットした場合はAI分類をスキップする', async () => {
      // キャッシュをセット
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

      // fetchが呼ばれていない = AI分類スキップ
      expect(fetchMock).not.toHaveBeenCalled()

      const result = getTabClassification(2)
      expect(result).toBeDefined()
      expect(result!.category).toBe('仕事')
    })

    it('AIキーが未設定の場合はフォールバック結果を返す', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        // openaiApiKey is missing
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
    })

    it('分類結果をClassificationCacheに保存する', async () => {
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
      expect(cache).toBeDefined()
      expect(cache!['learn.com:/typescript']).toBeDefined()
      expect(cache!['learn.com:/typescript'].result.category).toBe('学習')
    })
  })

  describe('getTabClassification', () => {
    it('未分類のタブIDにはundefinedを返す', async () => {
      const { getTabClassification } = await import('./message-handler')
      expect(getTabClassification(999)).toBeUndefined()
    })
  })

  describe('clearTabClassification', () => {
    it('指定タブIDの分類結果を削除する', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { handlePageInfo, getTabClassification, clearTabClassification } =
        await import('./message-handler')
      await handlePageInfo(5, {
        domain: 'example.com',
        url: 'https://example.com/',
        title: 'Example',
      })
      expect(getTabClassification(5)).toBeDefined()

      clearTabClassification(5)
      expect(getTabClassification(5)).toBeUndefined()
    })
  })

  describe('setupMessageListener', () => {
    it('chrome.runtime.onMessage.addListenerを呼ぶ', async () => {
      const { setupMessageListener } = await import('./message-handler')
      setupMessageListener()
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled()
    })

    it('PAGE_INFOメッセージでhandlePageInfoを呼ぶ', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { setupMessageListener, getTabClassification } = await import('./message-handler')
      setupMessageListener()

      // addListenerに渡されたコールバックを取得
      const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0]

      // PAGE_INFOメッセージをシミュレート
      callback(
        { type: 'PAGE_INFO', payload: { domain: 'test.com', url: 'https://test.com/', title: 'Test' } },
        { tab: { id: 10 } } as chrome.runtime.MessageSender,
        () => {},
      )

      // 非同期処理を待つ
      await new Promise((r) => setTimeout(r, 50))

      const result = getTabClassification(10)
      expect(result).toBeDefined()
    })

    it('OPEN_POPUPメッセージでポップアップページを新タブで開く', async () => {
      const { setupMessageListener } = await import('./message-handler')
      setupMessageListener()

      const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0]

      callback(
        { type: 'OPEN_POPUP' },
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
        () => {},
      )

      await new Promise((r) => setTimeout(r, 50))

      expect(chrome.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('popup.html') }),
      )
    })

    it('classificationCache変更時にtabClassificationsを更新する', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        openaiApiKey: 'test-key',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { setupMessageListener, handlePageInfo, getTabClassification } = await import('./message-handler')
      setupMessageListener()

      // タブ1にAI分類結果を設定
      await handlePageInfo(1, {
        domain: 'game.com',
        url: 'https://game.com/play',
        title: 'Game',
      })

      // AI結果を確認（娯楽 → 学習 に手動補正する）
      const before = getTabClassification(1)
      expect(before).toBeDefined()

      // onChanged リスナーを取得
      const onChangedCalls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls
      expect(onChangedCalls.length).toBeGreaterThanOrEqual(1)
      const storageListener = onChangedCalls[0][0] as (
        changes: Record<string, { newValue?: unknown }>,
        areaName: string,
      ) => void

      // classificationCache の手動補正をシミュレート
      const cacheKey = before!.cacheKey
      storageListener({
        classificationCache: {
          newValue: {
            [cacheKey]: {
              result: {
                category: '学習',
                isGrowth: true,
                confidence: 1.0,
                suggestedQuestTitle: '学習',
                suggestedSkill: 'ゲーム開発',
                cacheKey,
              },
              source: 'manual',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          },
        },
      }, 'local')

      // tabClassificationsが更新されていること
      const after = getTabClassification(1)
      expect(after).toBeDefined()
      expect(after!.category).toBe('学習')
      expect(after!.isGrowth).toBe(true)
    })

    it('手動修正されたcacheKeyに一致するタブのみ更新される', async () => {
      await setLocal('extensionSettings', {
        aiProvider: 'openai',
        openaiApiKey: 'test-key',
        blocklist: [],
        serverBaseUrl: '',
        syncEnabled: false,
        notificationsEnabled: true,
      })

      const { setupMessageListener, handlePageInfo, getTabClassification } = await import('./message-handler')
      setupMessageListener()

      // 2つのタブに分類結果を設定
      await handlePageInfo(1, { domain: 'game.com', url: 'https://game.com/play', title: 'Game' })
      await handlePageInfo(2, { domain: 'learn.com', url: 'https://learn.com/course', title: 'Course' })

      const tab1Before = getTabClassification(1)
      const tab2Before = getTabClassification(2)

      // onChangedリスナーを取得
      const storageListener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0] as (
        changes: Record<string, { newValue?: unknown }>,
        areaName: string,
      ) => void

      // game.com のみ手動補正
      storageListener({
        classificationCache: {
          newValue: {
            [tab1Before!.cacheKey]: {
              result: { ...tab1Before!, category: '学習', isGrowth: true },
              source: 'manual',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          },
        },
      }, 'local')

      // tab1のみ更新、tab2は変更なし
      expect(getTabClassification(1)!.category).toBe('学習')
      expect(getTabClassification(2)!.category).toBe(tab2Before!.category)
    })

    it('sender.tab.idがない場合は無視する', async () => {
      const { setupMessageListener, getTabClassification } = await import('./message-handler')
      setupMessageListener()

      const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0]

      // sender.tab が undefined
      callback(
        { type: 'PAGE_INFO', payload: { domain: 'test.com', url: 'https://test.com/', title: 'Test' } },
        {} as chrome.runtime.MessageSender,
        () => {},
      )

      await new Promise((r) => setTimeout(r, 50))
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
