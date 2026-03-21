import { afterEach, describe, expect, it, vi } from 'vitest'
import { SyncQueue } from '@ext/lib/sync-queue'

describe('SyncQueue', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds requests to the queue when offline', async () => {
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/user', method: 'PUT', body: { totalXp: 10 } })
    await queue.enqueue({ path: '/completions', method: 'POST', body: { id: 'c1' } })

    const pending = await queue.getPending()
    expect(pending).toHaveLength(2)
    expect(pending[0].path).toBe('/user')
    expect(pending[1].path).toBe('/completions')
  })

  it('replays queued requests in order', async () => {
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/user', method: 'PUT', body: { totalXp: 10 } })
    await queue.enqueue({ path: '/completions', method: 'POST', body: { id: 'c1' } })

    const calls: string[] = []
    const executor = async (req: { path: string; method: string; body: unknown }) => {
      calls.push(`${req.method} ${req.path}`)
    }

    await queue.replay(executor)

    expect(calls).toEqual(['PUT /user', 'POST /completions'])
    const remaining = await queue.getPending()
    expect(remaining).toHaveLength(0)
  })

  it('keeps failed requests in the queue for retry', async () => {
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/user', method: 'PUT', body: { totalXp: 10 } })
    await queue.enqueue({ path: '/completions', method: 'POST', body: { id: 'c1' } })

    let callCount = 0
    const executor = async (req: { path: string; method: string; body: unknown }) => {
      callCount++
      if (req.path === '/completions') {
        throw new Error('Network error')
      }
    }

    await queue.replay(executor)

    expect(callCount).toBe(2)
    // First request succeeded, second failed — only second remains
    const remaining = await queue.getPending()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].path).toBe('/completions')
  })

  it('MAX_RETRIES回失敗したリクエストをキューから削除する', async () => {
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/fail', method: 'POST', body: {} })

    const executor = async () => {
      throw new Error('Server error')
    }

    // 10回リプレイ（MAX_RETRIES = 10）
    for (let i = 0; i < 10; i++) {
      await queue.replay(executor)
    }

    const remaining = await queue.getPending()
    expect(remaining).toHaveLength(0)
  })

  it('NonRetryableErrorの場合は即座にキューから削除する', async () => {
    const { NonRetryableError } = await import('@ext/lib/sync-queue')
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/bad-request', method: 'POST', body: {} })

    const executor = async () => {
      throw new NonRetryableError('400 Bad Request')
    }

    await queue.replay(executor)

    const remaining = await queue.getPending()
    expect(remaining).toHaveLength(0)
  })

  it('retryCountが未定義の既存データでも正しく動作する', async () => {
    const queue = new SyncQueue()
    // 既存データを直接ストレージに書き込み（retryCountなし）
    await chrome.storage.local.set({
      syncQueue: [{ path: '/old', method: 'POST', body: {}, enqueuedAt: '2026-01-01' }],
    })

    const executor = async () => {
      throw new Error('fail')
    }

    await queue.replay(executor)

    const remaining = await queue.getPending()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].retryCount).toBe(1)
  })

  it('persists queue to chrome.storage.local', async () => {
    const queue1 = new SyncQueue()
    await queue1.enqueue({ path: '/test', method: 'POST', body: {} })

    // New instance should load from storage
    const queue2 = new SyncQueue()
    const pending = await queue2.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].path).toBe('/test')
  })
})
