import { describe, expect, it } from 'vitest'
import { evaluateProgress } from '@ext/background/quest-evaluator'
import { createMockDailyProgress } from '@ext/test/helpers'
import { BROWSING_XP } from '@ext/types/browsing'

describe('quest-evaluator', () => {
  describe('good browsing quests', () => {
    it('awards +2 XP at 30 minutes of growth browsing', () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        lastGoodRewardAtSeconds: 0,
      })
      const events = evaluateProgress(progress, [])
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'good_quest', xp: BROWSING_XP.GOOD_REWARD }),
      )
    })

    it('does not award XP before 30 minutes', () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 29 * 60 + 59,
        lastGoodRewardAtSeconds: 0,
      })
      const events = evaluateProgress(progress, [])
      expect(events.filter((e) => e.type === 'good_quest')).toHaveLength(0)
    })

    it('awards additional +2 XP at 90 minutes (30 + 60)', () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 90 * 60,
        lastGoodRewardAtSeconds: 30 * 60,
      })
      const events = evaluateProgress(progress, [])
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'good_quest', xp: BROWSING_XP.GOOD_REWARD }),
      )
    })

    it('does not award additional XP at 89 minutes', () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 89 * 60,
        lastGoodRewardAtSeconds: 30 * 60,
      })
      const events = evaluateProgress(progress, [])
      expect(events.filter((e) => e.type === 'good_quest')).toHaveLength(0)
    })

    it('awards additional +2 XP at 150 minutes (30 + 60 + 60)', () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 150 * 60,
        lastGoodRewardAtSeconds: 90 * 60,
      })
      const events = evaluateProgress(progress, [])
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'good_quest', xp: BROWSING_XP.GOOD_REWARD }),
      )
    })
  })

  describe('bad browsing penalties', () => {
    it('triggers warning at 50 minutes of blocklisted non-growth browsing', () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 50 * 60,
        domainTimes: {
          'game.com:/': {
            domain: 'game.com',
            cacheKey: 'game.com:/',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 50 * 60,
            lastUpdated: '',
          },
        },
      })
      const events = evaluateProgress(progress, [])
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'warning', domain: 'game.com' }),
      )
    })

    it('does not repeat warning for the same domain', () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 55 * 60,
        warningShownDomains: ['game.com'],
        domainTimes: {
          'game.com:/': {
            domain: 'game.com',
            cacheKey: 'game.com:/',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 55 * 60,
            lastUpdated: '',
          },
        },
      })
      const events = evaluateProgress(progress, [])
      expect(events.filter((e) => e.type === 'warning' && e.domain === 'game.com')).toHaveLength(0)
    })

    it('penalizes -5 XP at 60 minutes of blocklisted non-growth browsing', () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 60 * 60,
        lastBadPenaltyAtSeconds: 0,
      })
      const events = evaluateProgress(progress, [])
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'bad_quest', xp: -BROWSING_XP.BAD_PENALTY }),
      )
    })

    it('penalizes additional -5 XP at 120 minutes', () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 120 * 60,
        lastBadPenaltyAtSeconds: 60 * 60,
      })
      const events = evaluateProgress(progress, [])
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'bad_quest', xp: -BROWSING_XP.BAD_PENALTY }),
      )
    })

    it('does not penalize before 60 minutes', () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 59 * 60 + 59,
        lastBadPenaltyAtSeconds: 0,
      })
      const events = evaluateProgress(progress, [])
      expect(events.filter((e) => e.type === 'bad_quest')).toHaveLength(0)
    })
  })

  describe('XP floor', () => {
    it('does not let XP go below 0', () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 60 * 60,
        lastBadPenaltyAtSeconds: 0,
        xpLost: 0,
      })
      const events = evaluateProgress(progress, [], { currentXp: 3 })
      const badEvent = events.find((e) => e.type === 'bad_quest')
      expect(badEvent).toBeDefined()
      // Penalty should be capped at currentXp
      expect(badEvent!.xp).toBe(-3)
    })

    it('returns 0 penalty when XP is already 0', () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 60 * 60,
        lastBadPenaltyAtSeconds: 0,
      })
      const events = evaluateProgress(progress, [], { currentXp: 0 })
      const badEvent = events.find((e) => e.type === 'bad_quest')
      expect(badEvent).toBeDefined()
      expect(badEvent!.xp).toBe(0)
    })
  })

  describe('blocklisted domain with growth content', () => {
    it('treats blocklisted growth content as normal quest, not bad quest', () => {
      const progress = createMockDailyProgress({
        // This is good browsing even though domain is blocklisted
        goodBrowsingSeconds: 30 * 60,
        badBrowsingSeconds: 0,
        lastGoodRewardAtSeconds: 0,
      })
      const events = evaluateProgress(progress, ['youtube.com'])
      // Should get good_quest, not bad_quest
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'good_quest' }),
      )
      expect(events.filter((e) => e.type === 'bad_quest')).toHaveLength(0)
    })
  })

  describe('mixed browsing', () => {
    it('handles good and bad browsing simultaneously', () => {
      const progress = createMockDailyProgress({
        goodBrowsingSeconds: 30 * 60,
        badBrowsingSeconds: 60 * 60,
        lastGoodRewardAtSeconds: 0,
        lastBadPenaltyAtSeconds: 0,
      })
      const events = evaluateProgress(progress, [])
      expect(events.filter((e) => e.type === 'good_quest')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'bad_quest')).toHaveLength(1)
    })
  })

  describe('warning domain aggregation', () => {
    it('triggers warning per blocklisted domain at 50 minutes', () => {
      const progress = createMockDailyProgress({
        badBrowsingSeconds: 100 * 60,
        domainTimes: {
          'game1.com:/': {
            domain: 'game1.com',
            cacheKey: 'game1.com:/',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 50 * 60,
            lastUpdated: '',
          },
          'game2.com:/': {
            domain: 'game2.com',
            cacheKey: 'game2.com:/',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 50 * 60,
            lastUpdated: '',
          },
        },
      })
      const events = evaluateProgress(progress, [])
      const warnings = events.filter((e) => e.type === 'warning')
      expect(warnings).toHaveLength(2)
    })
  })
})
