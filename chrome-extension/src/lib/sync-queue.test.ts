import { afterEach, describe, expect, it, vi } from 'vitest'
import { NonRetryableError, SyncQueue } from '@ext/lib/sync-queue'

describe('SyncQueue', () => {
  afterEach(() => {
    vi.useRealTimers()
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

  it('enqueuedAt は JST の RFC3339 文字列で保存する', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-21T03:04:05.006Z'))

    const queue = new SyncQueue()
    await queue.enqueue({ path: '/user', method: 'PUT', body: { totalXp: 10 } })

    const [pending] = await queue.getPending()
    expect(pending.enqueuedAt).toBe('2026-03-21T12:04:05.006+09:00')
    expect(new Date(pending.enqueuedAt).getTime()).toBe(new Date('2026-03-21T03:04:05.006Z').getTime())
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
    expect(await queue.getPending()).toHaveLength(0)
  })

  it('keeps failed requests in the queue for retry', async () => {
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/user', method: 'PUT', body: { totalXp: 10 } })
    await queue.enqueue({ path: '/completions', method: 'POST', body: { id: 'c1' } })

    let callCount = 0
    const executor = async (req: { path: string; method: string; body: unknown }) => {
      callCount += 1
      if (req.path === '/completions') {
        throw new Error('Network error')
      }
    }

    await queue.replay(executor)

    expect(callCount).toBe(2)
    const remaining = await queue.getPending()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].path).toBe('/completions')
  })

  it('drops a request after MAX_RETRIES failures', async () => {
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/fail', method: 'POST', body: {} })

    const executor = async () => {
      throw new Error('Server error')
    }

    for (let i = 0; i < 10; i += 1) {
      await queue.replay(executor)
    }

    expect(await queue.getPending()).toHaveLength(0)
  })

  it('drops NonRetryableError requests immediately', async () => {
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/bad-request', method: 'POST', body: {} })

    const executor = async () => {
      throw new NonRetryableError('400 Bad Request')
    }

    await queue.replay(executor)

    expect(await queue.getPending()).toHaveLength(0)
  })

  it('increments retryCount for existing queued data', async () => {
    const queue = new SyncQueue()
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

    const queue2 = new SyncQueue()
    const pending = await queue2.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].path).toBe('/test')
  })

  it('preserves requests enqueued while replay is in progress', async () => {
    const queue = new SyncQueue()
    await queue.enqueue({ path: '/first', method: 'POST', body: { id: 1 } })

    let releaseReplay!: () => void
    const executor = vi.fn(() => new Promise<void>((resolve) => {
      releaseReplay = resolve
    }))

    const replayPromise = queue.replay(executor)
    await Promise.resolve()
    await queue.enqueue({ path: '/second', method: 'POST', body: { id: 2 } })
    releaseReplay()
    await replayPromise

    const remaining = await queue.getPending()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].path).toBe('/second')
  })
})
