import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimeAccumulator } from '@ext/background/time-accumulator'
import type { DailyProgress } from '@ext/types/browsing'

describe('TimeAccumulator', () => {
  let accumulator: TimeAccumulator
  const TODAY = '2026-03-21'

  beforeEach(() => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(`${TODAY}T12:00:00.000Z`)
    accumulator = new TimeAccumulator()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accumulates time for a domain', async () => {
    await accumulator.addTime('example.com', 'example.com:/', 60, true, false)
    const progress = await accumulator.getDailyProgress()

    expect(progress.domainTimes['example.com:/']).toBeDefined()
    expect(progress.domainTimes['example.com:/'].totalSeconds).toBe(60)
    expect(progress.domainTimes['example.com:/'].domain).toBe('example.com')
  })

  it('accumulates time on the same domain cacheKey', async () => {
    await accumulator.addTime('example.com', 'example.com:/', 30, true, false)
    await accumulator.addTime('example.com', 'example.com:/', 45, true, false)
    const progress = await accumulator.getDailyProgress()

    expect(progress.domainTimes['example.com:/'].totalSeconds).toBe(75)
  })

  it('tracks different domains separately', async () => {
    await accumulator.addTime('a.com', 'a.com:/', 100, true, false)
    await accumulator.addTime('b.com', 'b.com:/', 200, false, true)
    const progress = await accumulator.getDailyProgress()

    expect(progress.domainTimes['a.com:/'].totalSeconds).toBe(100)
    expect(progress.domainTimes['b.com:/'].totalSeconds).toBe(200)
  })

  it('updates goodBrowsingSeconds for growth content', async () => {
    await accumulator.addTime('learn.com', 'learn.com:/', 120, true, false)
    const progress = await accumulator.getDailyProgress()

    expect(progress.goodBrowsingSeconds).toBe(120)
    expect(progress.badBrowsingSeconds).toBe(0)
  })

  it('updates badBrowsingSeconds for blocklisted non-growth content', async () => {
    await accumulator.addTime('game.com', 'game.com:/', 90, false, true)
    const progress = await accumulator.getDailyProgress()

    expect(progress.badBrowsingSeconds).toBe(90)
    expect(progress.goodBrowsingSeconds).toBe(0)
  })

  it('updates otherBrowsingSeconds for non-growth non-blocklisted content', async () => {
    await accumulator.addTime('news.com', 'news.com:/', 60, false, false)
    const progress = await accumulator.getDailyProgress()

    expect(progress.otherBrowsingSeconds).toBe(60)
  })

  it('resets daily progress when date changes', async () => {
    await accumulator.addTime('example.com', 'example.com:/', 100, true, false)

    // Simulate date change
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-03-22T01:00:00.000Z')

    const progress = await accumulator.getDailyProgress()
    expect(progress.date).toBe('2026-03-22')
    expect(progress.goodBrowsingSeconds).toBe(0)
    expect(Object.keys(progress.domainTimes)).toHaveLength(0)
  })

  it('persists and restores daily progress via chrome.storage.local', async () => {
    await accumulator.addTime('example.com', 'example.com:/', 50, true, false)

    // Create a new accumulator that should load from storage
    const accumulator2 = new TimeAccumulator()
    const progress = await accumulator2.getDailyProgress()

    expect(progress.goodBrowsingSeconds).toBe(50)
    expect(progress.domainTimes['example.com:/'].totalSeconds).toBe(50)
  })

  it('creates fresh progress with correct date', async () => {
    const progress = await accumulator.getDailyProgress()
    expect(progress.date).toBe(TODAY)
    expect(progress.goodBrowsingSeconds).toBe(0)
    expect(progress.badBrowsingSeconds).toBe(0)
    expect(progress.otherBrowsingSeconds).toBe(0)
    expect(progress.goodQuestsCleared).toBe(0)
    expect(progress.badQuestsTriggered).toBe(0)
    expect(progress.xpGained).toBe(0)
    expect(progress.xpLost).toBe(0)
  })

  it('allows updating progress fields directly', async () => {
    await accumulator.updateProgress((p: DailyProgress) => {
      p.goodQuestsCleared = 3
      p.xpGained = 6
    })
    const progress = await accumulator.getDailyProgress()
    expect(progress.goodQuestsCleared).toBe(3)
    expect(progress.xpGained).toBe(6)
  })
})
