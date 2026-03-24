import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logActivity, flushActivityLogs, logError } from './activity-logger'
import { getLocal, setLocal } from '@ext/lib/storage'

describe('activity-logger', () => {
  beforeEach(async () => {
    await setLocal('activityLogBuffer', [])
  })

  describe('logActivity', () => {
    it('chrome.storage.localにログエントリが追加される', async () => {
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

    it('timestampがJST形式(+09:00)で記録される', async () => {
      await logActivity('test', 'test')
      const buffer = await getLocal<Array<{ timestamp: string }>>('activityLogBuffer')
      expect(buffer![0].timestamp).toMatch(/\+09:00$/)
    })

    it('複数のログエントリが蓄積される', async () => {
      await logActivity('a', 'test')
      await logActivity('b', 'test')
      await logActivity('c', 'test')
      const buffer = await getLocal<unknown[]>('activityLogBuffer')
      expect(buffer).toHaveLength(3)
    })

    it('detailsのデフォルトは空オブジェクト', async () => {
      await logActivity('test', 'test')
      const buffer = await getLocal<Array<{ details: unknown }>>('activityLogBuffer')
      expect(buffer![0].details).toEqual({})
    })
  })

  describe('logError', () => {
    it('Errorオブジェクトをerrorカテゴリとしてバッファに追加する', async () => {
      await logError(new Error('something went wrong'), 'test-context')
      const buffer = await getLocal<unknown[]>('activityLogBuffer')
      expect(buffer).toHaveLength(1)
      expect(buffer![0]).toEqual(expect.objectContaining({
        action: 'system.error',
        category: 'error',
        source: 'chrome-extension',
      }))
    })

    it('detailsにname・message・stack・contextが含まれる', async () => {
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

    it('文字列エラーをErrorに変換してバッファに追加する', async () => {
      await logError('string error', 'test-context')
      const buffer = await getLocal<Array<{ details: Record<string, unknown> }>>('activityLogBuffer')
      expect(buffer![0].details.message).toBe('string error')
    })

    it('contextが省略された場合unknownを使う', async () => {
      await logError(new Error('oops'))
      const buffer = await getLocal<Array<{ details: Record<string, unknown> }>>('activityLogBuffer')
      expect(buffer![0].details.context).toBe('unknown')
    })
  })

  describe('flushActivityLogs', () => {
    it('バッファをAPIに送信してクリアする', async () => {
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

    it('バッファが空の場合はAPIを呼ばない', async () => {
      const mockApiClient = {
        postActivityLogs: vi.fn(),
      }
      await flushActivityLogs(mockApiClient as any)
      expect(mockApiClient.postActivityLogs).not.toHaveBeenCalled()
    })

    it('API失敗時にバッファが保持される', async () => {
      await logActivity('test', 'test')

      const mockApiClient = {
        postActivityLogs: vi.fn().mockRejectedValue(new Error('Network error')),
      }
      await flushActivityLogs(mockApiClient as any).catch(() => {})

      const buffer = await getLocal<unknown[]>('activityLogBuffer')
      expect(buffer).toHaveLength(1)
    })
  })
})
