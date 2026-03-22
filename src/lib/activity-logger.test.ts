import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock api-client before importing
vi.mock('@/lib/api-client', () => ({
  postActivityLogs: vi.fn().mockResolvedValue({ logged: 0 }),
}))

import { logActivity, flush, _getBuffer, _reset } from './activity-logger'
import { postActivityLogs } from '@/lib/api-client'

const mockedPost = vi.mocked(postActivityLogs)

describe('activity-logger', () => {
  beforeEach(() => {
    _reset()
    mockedPost.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('バッファにログエントリが追加される', () => {
    logActivity('quest.create', 'quest', { questId: 'q1' })
    expect(_getBuffer()).toHaveLength(1)
    expect(_getBuffer()[0].action).toBe('quest.create')
    expect(_getBuffer()[0].source).toBe('web')
  })

  it('timestampがJST形式(+09:00)で記録される', () => {
    logActivity('test', 'test')
    expect(_getBuffer()[0].timestamp).toMatch(/\+09:00$/)
  })

  it('30秒後にフラッシュが呼ばれる', async () => {
    mockedPost.mockResolvedValueOnce({ logged: 1 })
    logActivity('test', 'test')

    await vi.advanceTimersByTimeAsync(30_000)

    expect(mockedPost).toHaveBeenCalledTimes(1)
    expect(mockedPost).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ action: 'test', source: 'web' }),
      ])
    )
  })

  it('flush()で空バッファの場合はAPIを呼ばない', async () => {
    await flush()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('flush()でバッファが送信後クリアされる', async () => {
    mockedPost.mockResolvedValueOnce({ logged: 2 })
    logActivity('a', 'test')
    logActivity('b', 'test')

    await flush()

    expect(mockedPost).toHaveBeenCalledTimes(1)
    expect(_getBuffer()).toHaveLength(0)
  })

  it('flush()失敗時にエントリがバッファに戻される', async () => {
    mockedPost.mockRejectedValueOnce(new Error('Network error'))
    logActivity('test', 'test')

    await flush()

    expect(_getBuffer()).toHaveLength(1)
    expect(_getBuffer()[0].action).toBe('test')
  })

  it('detailsのデフォルトは空オブジェクト', () => {
    logActivity('test', 'test')
    expect(_getBuffer()[0].details).toEqual({})
  })
})
