import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassificationCache } from '@ext/lib/classification-cache'
import { createMockClassificationResult } from '@ext/test/helpers'

describe('ClassificationCache', () => {
  let cache: ClassificationCache
  const NOW = new Date('2026-03-21T12:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    cache = new ClassificationCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and retrieves a classification result', async () => {
    const result = createMockClassificationResult({ cacheKey: 'example.com:/page' })
    await cache.set('example.com:/page', result, 'ai')

    const cached = await cache.get('example.com:/page')
    expect(cached).toBeDefined()
    expect(cached!.result.category).toBe('学習')
    expect(cached!.source).toBe('ai')
  })

  it('stores createdAt and expiresAt as JST RFC3339 while preserving TTL instant', async () => {
    const result = createMockClassificationResult({ cacheKey: 'time.example:/' })
    await cache.set('time.example:/', result, 'ai')

    const cached = await cache.get('time.example:/')
    expect(cached!.createdAt).toBe('2026-03-21T21:00:00.000+09:00')
    expect(cached!.expiresAt).toMatch(/\+09:00$/)
    expect(new Date(cached!.expiresAt).getTime()).toBe(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
  })

  it('returns null for non-existent cache key', async () => {
    const cached = await cache.get('nonexistent')
    expect(cached).toBeNull()
  })

  it('hits cache for the same cacheKey', async () => {
    const result = createMockClassificationResult({ cacheKey: 'test.com:/' })
    await cache.set('test.com:/', result, 'ai')

    const hit1 = await cache.get('test.com:/')
    const hit2 = await cache.get('test.com:/')
    expect(hit1).toEqual(hit2)
  })

  it('ignores expired entries (TTL 30 days)', async () => {
    const result = createMockClassificationResult({ cacheKey: 'old.com:/' })
    await cache.set('old.com:/', result, 'ai')

    // Advance 31 days
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'))

    const cached = await cache.get('old.com:/')
    expect(cached).toBeNull()
  })

  it('does not expire entries within TTL', async () => {
    const result = createMockClassificationResult({ cacheKey: 'fresh.com:/' })
    await cache.set('fresh.com:/', result, 'ai')

    // Advance 29 days
    vi.setSystemTime(new Date('2026-04-19T12:00:00Z'))

    const cached = await cache.get('fresh.com:/')
    expect(cached).not.toBeNull()
  })

  it('manual override takes priority over AI result', async () => {
    const aiResult = createMockClassificationResult({
      cacheKey: 'youtube.com:/watch',
      category: '娯楽',
      isGrowth: false,
    })
    await cache.set('youtube.com:/watch', aiResult, 'ai')

    const manualResult = createMockClassificationResult({
      cacheKey: 'youtube.com:/watch',
      category: '学習',
      isGrowth: true,
    })
    await cache.set('youtube.com:/watch', manualResult, 'manual')

    const cached = await cache.get('youtube.com:/watch')
    expect(cached!.result.category).toBe('学習')
    expect(cached!.source).toBe('manual')
  })

  it('エントリを削除できる', async () => {
    const result = createMockClassificationResult({ cacheKey: 'delete.com:/' })
    await cache.set('delete.com:/', result, 'manual')

    await cache.delete('delete.com:/')

    const cached = await cache.get('delete.com:/')
    expect(cached).toBeNull()
  })

  it('存在しないキーの削除はエラーにならない', async () => {
    await expect(cache.delete('nonexistent')).resolves.not.toThrow()
  })

  it('persists cache to chrome.storage.local', async () => {
    const result = createMockClassificationResult({ cacheKey: 'persist.com:/' })
    await cache.set('persist.com:/', result, 'ai')

    // Create a new cache instance — should load from storage
    const cache2 = new ClassificationCache()
    const cached = await cache2.get('persist.com:/')
    expect(cached).not.toBeNull()
    expect(cached!.result.category).toBe('学習')
  })
})
