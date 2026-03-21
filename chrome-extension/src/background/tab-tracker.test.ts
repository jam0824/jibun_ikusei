import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabTracker } from '@ext/background/tab-tracker'

describe('TabTracker', () => {
  let tracker: TabTracker
  let now: number

  beforeEach(() => {
    now = 1000000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    tracker = new TabTracker()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null elapsed when no previous tab was tracked', () => {
    const result = tracker.onTabActivated(1, 'https://example.com/')
    expect(result).toBeNull()
  })

  it('returns elapsed seconds on tab switch', () => {
    tracker.onTabActivated(1, 'https://example.com/')

    // 45 seconds later, switch to another tab
    now += 45_000
    const result = tracker.onTabActivated(2, 'https://other.com/')

    expect(result).toEqual({
      tabId: 1,
      url: 'https://example.com/',
      domain: 'example.com',
      elapsedSeconds: 45,
    })
  })

  it('accumulates time across multiple switches', () => {
    tracker.onTabActivated(1, 'https://a.com/')

    now += 10_000
    const r1 = tracker.onTabActivated(2, 'https://b.com/')
    expect(r1?.elapsedSeconds).toBe(10)

    now += 20_000
    const r2 = tracker.onTabActivated(1, 'https://a.com/')
    expect(r2?.elapsedSeconds).toBe(20)
    expect(r2?.domain).toBe('b.com')
  })

  it('stops timing on window blur (WINDOW_ID_NONE)', () => {
    tracker.onTabActivated(1, 'https://example.com/')

    now += 30_000
    const result = tracker.onWindowBlur()
    expect(result).toEqual({
      tabId: 1,
      url: 'https://example.com/',
      domain: 'example.com',
      elapsedSeconds: 30,
    })
  })

  it('returns null on blur when no tab is tracked', () => {
    const result = tracker.onWindowBlur()
    expect(result).toBeNull()
  })

  it('resumes timing on window focus', () => {
    tracker.onTabActivated(1, 'https://example.com/')
    now += 10_000
    tracker.onWindowBlur()

    // 5 seconds of blur — should not count
    now += 5_000
    tracker.onWindowFocus(1, 'https://example.com/')

    // 20 seconds of active time after focus
    now += 20_000
    const result = tracker.onTabActivated(2, 'https://other.com/')
    expect(result?.elapsedSeconds).toBe(20)
  })

  it('handles URL navigation within the same tab (same domain)', () => {
    tracker.onTabActivated(1, 'https://example.com/page1')

    now += 15_000
    const result = tracker.onUrlChanged(1, 'https://example.com/page2')

    // Same domain — returns elapsed for the old URL, keeps tracking same tab
    expect(result).toEqual({
      tabId: 1,
      url: 'https://example.com/page1',
      domain: 'example.com',
      elapsedSeconds: 15,
    })
  })

  it('handles URL navigation within the same tab (different domain)', () => {
    tracker.onTabActivated(1, 'https://example.com/page1')

    now += 20_000
    const result = tracker.onUrlChanged(1, 'https://different.com/page1')

    expect(result).toEqual({
      tabId: 1,
      url: 'https://example.com/page1',
      domain: 'example.com',
      elapsedSeconds: 20,
    })
  })

  it('ignores URL changes for non-active tabs', () => {
    tracker.onTabActivated(1, 'https://example.com/')

    now += 10_000
    const result = tracker.onUrlChanged(999, 'https://other.com/')
    expect(result).toBeNull()
  })

  it('extracts domain from URL correctly', () => {
    tracker.onTabActivated(1, 'https://sub.example.co.jp/path?q=1')
    now += 5_000
    const result = tracker.onTabActivated(2, 'https://other.com/')
    expect(result?.domain).toBe('sub.example.co.jp')
  })

  it('handles chrome:// and about: URLs by returning empty domain', () => {
    tracker.onTabActivated(1, 'chrome://extensions/')
    now += 5_000
    const result = tracker.onTabActivated(2, 'https://example.com/')
    expect(result?.domain).toBe('')
  })

  it('flushes current tab timing', () => {
    tracker.onTabActivated(1, 'https://example.com/')
    now += 60_000
    const result = tracker.flush()
    expect(result).toEqual({
      tabId: 1,
      url: 'https://example.com/',
      domain: 'example.com',
      elapsedSeconds: 60,
    })
  })

  it('flush resets the start time so next flush only counts new time', () => {
    tracker.onTabActivated(1, 'https://example.com/')
    now += 30_000
    tracker.flush()

    now += 10_000
    const result = tracker.flush()
    expect(result?.elapsedSeconds).toBe(10)
  })

  it('flush returns null when paused (after blur)', () => {
    tracker.onTabActivated(1, 'https://example.com/')
    now += 10_000
    tracker.onWindowBlur()

    const result = tracker.flush()
    expect(result).toBeNull()
  })
})
