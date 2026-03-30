import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushActivityLogs, logActivity, logError } from './activity-logger'
import { getLocal, setLocal } from '@ext/lib/storage'

describe('activity-logger', () => {
  beforeEach(async () => {
    await setLocal('activityLogBuffer', [])
  })

  describe('logActivity', () => {
    it('chrome.storage.local にログエントリを追加する', async () => {
      await logActivity('xp.gain', 'xp', { xp: 2 })
      const buffer = await getLocal<unknown[]>('activityLogBuffer')

      expect(buffer).toHaveLength(1)
      expect(buffer![0]).toEqual(expect.objectContaining({
        action: 'xp.gain',
        category: 'xp',
        source: 'chrome-extension',
        details: { xp: 2 },
      }))
    })

    it('timestamp は JST 形式で記録される', async () => {
      await logActivity('test', 'test')
      const buffer = await getLocal<Array<{ timestamp: string }>>('activityLogBuffer')

      expect(buffer![0].timestamp).toMatch(/\+09:00$/)
    })

    it('複数のログエントリを蓄積できる', async () => {
      await logActivity('a', 'test')
      await logActivity('b', 'test')
      await logActivity('c', 'test')

      const buffer = await getLocal<unknown[]>('activityLogBuffer')
      expect(buffer).toHaveLength(3)
    })

    it('details のデフォルトは空オブジェクト', async () => {
      await logActivity('test', 'test')
      const buffer = await getLocal<Array<{ details: unknown }>>('activityLogBuffer')

      expect(buffer![0].details).toEqual({})
    })
  })

  describe('logError', () => {
    it('Error オブジェクトを error カテゴリとしてバッファに追加する', async () => {
      await logError(new Error('something went wrong'), 'test-context')
      const buffer = await getLocal<unknown[]>('activityLogBuffer')

      expect(buffer).toHaveLength(1)
      expect(buffer![0]).toEqual(expect.objectContaining({
        action: 'system.error',
        category: 'error',
        source: 'chrome-extension',
      }))
    })

    it('details に name message stack context が含まれる', async () => {
      const err = new Error('test error')
      await logError(err, 'alarm:sync')
      const buffer = await getLocal<Array<{ details: Record<string, unknown> }>>('activityLogBuffer')

      expect(buffer![0].details).toMatchObject({
        name: 'Error',
        message: 'test error',
        context: 'alarm:sync',
      })
      expect(buffer![0].details.stack).toBeTypeOf('string')
    })

    it('文字列エラーも Error に変換してバッファへ追加する', async () => {
      await logError('string error', 'test-context')
      const buffer = await getLocal<Array<{ details: Record<string, unknown> }>>('activityLogBuffer')

      expect(buffer![0].details.message).toBe('string error')
    })

    it('context 未指定時は unknown を使う', async () => {
      await logError(new Error('oops'))
      const buffer = await getLocal<Array<{ details: Record<string, unknown> }>>('activityLogBuffer')

      expect(buffer![0].details.context).toBe('unknown')
    })
  })

  describe('flushActivityLogs', () => {
    it('バッファを API に送信してクリアする', async () => {
      await logActivity('test1', 'test')
      await logActivity('test2', 'test')

      const mockApiClient = {
        postActivityLogs: vi.fn().mockResolvedValue({ logged: 2 }),
      }
      await flushActivityLogs(mockApiClient as any)

      expect(mockApiClient.postActivityLogs).toHaveBeenCalledWith({
        entries: expect.arrayContaining([
          expect.objectContaining({ action: 'test1' }),
          expect.objectContaining({ action: 'test2' }),
        ]),
      })

      const buffer = await getLocal<unknown[]>('activityLogBuffer')
      expect(buffer).toEqual([])
    })

    it('バッファが空のときは API を呼ばない', async () => {
      const mockApiClient = {
        postActivityLogs: vi.fn(),
      }
      await flushActivityLogs(mockApiClient as any)

      expect(mockApiClient.postActivityLogs).not.toHaveBeenCalled()
    })

    it('API 失敗時はバッファを保持する', async () => {
      await logActivity('test', 'test')

      const mockApiClient = {
        postActivityLogs: vi.fn().mockRejectedValue(new Error('Network error')),
      }
      await flushActivityLogs(mockApiClient as any).catch(() => {})

      const buffer = await getLocal<unknown[]>('activityLogBuffer')
      expect(buffer).toHaveLength(1)
    })

    it('flush 中に追加された新規ログを消さない', async () => {
      await logActivity('before-flush', 'test')

      let resolvePost!: () => void
      const mockApiClient = {
        postActivityLogs: vi.fn(() => new Promise<void>((resolve) => {
          resolvePost = resolve
        })),
      }

      const flushPromise = flushActivityLogs(mockApiClient as any)
      await Promise.resolve()
      await logActivity('during-flush', 'test')
      resolvePost()
      await flushPromise

      const buffer = await getLocal<Array<{ action: string }>>('activityLogBuffer')
      expect(buffer).toEqual([
        expect.objectContaining({ action: 'during-flush' }),
      ])
    })
  })
})
