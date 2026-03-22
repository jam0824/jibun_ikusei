import { describe, expect, it } from 'vitest'
import { buildCacheKey } from '@ext/lib/cache-key'
import type { PageInfo } from '@ext/types/browsing'

function page(overrides: Partial<PageInfo> = {}): PageInfo {
  return {
    domain: 'example.com',
    url: 'https://example.com/',
    title: 'Test',
    ...overrides,
  }
}

describe('buildCacheKey', () => {
  it('pathnameを含むキーを生成する', () => {
    const result = buildCacheKey(page({ url: 'https://example.com/learn/typescript' }))
    expect(result).toBe('example.com:/learn/typescript')
  })

  it('YouTubeの動画IDごとに異なるキーを生成する', () => {
    const video1 = buildCacheKey(
      page({ domain: 'youtube.com', url: 'https://www.youtube.com/watch?v=abc123' }),
    )
    const video2 = buildCacheKey(
      page({ domain: 'youtube.com', url: 'https://www.youtube.com/watch?v=xyz789' }),
    )
    expect(video1).not.toBe(video2)
    expect(video1).toBe('youtube.com:/watch?v=abc123')
    expect(video2).toBe('youtube.com:/watch?v=xyz789')
  })

  it('トラッキングパラメータを除外する', () => {
    const withTracking = buildCacheKey(
      page({ url: 'https://example.com/page?id=1&utm_source=google&fbclid=abc&ref=top' }),
    )
    const withoutTracking = buildCacheKey(
      page({ url: 'https://example.com/page?id=1' }),
    )
    expect(withTracking).toBe(withoutTracking)
    expect(withTracking).toBe('example.com:/page?id=1')
  })

  it('クエリパラメータをソートして安定したキーにする', () => {
    const key1 = buildCacheKey(page({ url: 'https://example.com/page?b=2&a=1' }))
    const key2 = buildCacheKey(page({ url: 'https://example.com/page?a=1&b=2' }))
    expect(key1).toBe(key2)
    expect(key1).toBe('example.com:/page?a=1&b=2')
  })

  it('クエリパラメータがない場合は?を付けない', () => {
    const result = buildCacheKey(page({ url: 'https://example.com/about' }))
    expect(result).toBe('example.com:/about')
  })

  it('トラッキングパラメータのみの場合はクエリなし', () => {
    const result = buildCacheKey(
      page({ url: 'https://example.com/page?utm_source=twitter&si=abc' }),
    )
    expect(result).toBe('example.com:/page')
  })

  it('不正なURLの場合はドメイン+/をフォールバック', () => {
    const result = buildCacheKey(page({ url: 'not-a-url' }))
    expect(result).toBe('example.com:/')
  })

  it('YouTube siパラメータを除外してvパラメータを保持する', () => {
    const result = buildCacheKey(
      page({ domain: 'youtube.com', url: 'https://www.youtube.com/watch?v=abc123&si=tracking' }),
    )
    expect(result).toBe('youtube.com:/watch?v=abc123')
  })
})
