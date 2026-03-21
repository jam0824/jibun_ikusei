import { describe, expect, it } from 'vitest'

describe('shared-instances', () => {
  it('同じTimeAccumulatorインスタンスをエクスポートする', async () => {
    const { timeAccumulator: a } = await import('./shared-instances')
    const { timeAccumulator: b } = await import('./shared-instances')
    expect(a).toBe(b)
  })

  it('同じSyncQueueインスタンスをエクスポートする', async () => {
    const { syncQueue: a } = await import('./shared-instances')
    const { syncQueue: b } = await import('./shared-instances')
    expect(a).toBe(b)
  })

  it('同じApiClientインスタンスをエクスポートする', async () => {
    const { apiClient: a } = await import('./shared-instances')
    const { apiClient: b } = await import('./shared-instances')
    expect(a).toBe(b)
  })
})
