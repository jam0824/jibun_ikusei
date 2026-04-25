import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateWeeklyReport } from '@ext/background/weekly-report-generator'
import { createMockDailyProgress } from '@ext/test/helpers'

describe('weekly-report-generator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('空の履歴から週次レポートを生成する', () => {
    const report = generateWeeklyReport([], '2026-W12')
    expect(report.weekKey).toBe('2026-W12')
    expect(report.totalMinutes).toBe(0)
    expect(report.goodMinutes).toBe(0)
    expect(report.badMinutes).toBe(0)
    expect(report.goodQuestsCleared).toBe(0)
    expect(report.badQuestsTriggered).toBe(0)
    expect(report.topGrowthDomains).toHaveLength(0)
  })

  it('複数日のDailyProgressを集計する', () => {
    const history = [
      createMockDailyProgress({
        date: '2026-03-16',
        goodBrowsingSeconds: 60 * 60,   // 60分
        badBrowsingSeconds: 30 * 60,     // 30分
        otherBrowsingSeconds: 15 * 60,   // 15分
        goodQuestsCleared: 2,
        badQuestsTriggered: 1,
      }),
      createMockDailyProgress({
        date: '2026-03-17',
        goodBrowsingSeconds: 90 * 60,   // 90分
        badBrowsingSeconds: 0,
        otherBrowsingSeconds: 10 * 60,   // 10分
        goodQuestsCleared: 3,
        badQuestsTriggered: 0,
      }),
    ]
    const report = generateWeeklyReport(history, '2026-W12')
    expect(report.totalMinutes).toBe(60 + 30 + 15 + 90 + 10)
    expect(report.goodMinutes).toBe(60 + 90)
    expect(report.badMinutes).toBe(30)
    expect(report.goodQuestsCleared).toBe(5)
    expect(report.badQuestsTriggered).toBe(1)
  })

  it('カテゴリ別の閲覧時間を集計する', () => {
    const history = [
      createMockDailyProgress({
        date: '2026-03-16',
        domainTimes: {
          'learn.com:/': {
            domain: 'learn.com',
            cacheKey: 'learn.com:/',
            category: '学習',
            isGrowth: true,
            isBlocklisted: false,
            totalSeconds: 30 * 60,
            lastUpdated: '',
          },
          'work.com:/': {
            domain: 'work.com',
            cacheKey: 'work.com:/',
            category: '仕事',
            isGrowth: true,
            isBlocklisted: false,
            totalSeconds: 45 * 60,
            lastUpdated: '',
          },
          'game.com:/': {
            domain: 'game.com',
            cacheKey: 'game.com:/',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 20 * 60,
            lastUpdated: '',
          },
        },
      }),
    ]
    const report = generateWeeklyReport(history, '2026-W12')
    expect(report.categoryBreakdown['学習']).toBe(30)
    expect(report.categoryBreakdown['仕事']).toBe(45)
    expect(report.categoryBreakdown['娯楽']).toBe(20)
    expect(report.categoryBreakdown['健康']).toBe(0)
  })

  it('成長ドメイン上位を秒数降順で返す', () => {
    const history = [
      createMockDailyProgress({
        date: '2026-03-16',
        domainTimes: {
          'learn.com:/': {
            domain: 'learn.com',
            cacheKey: 'learn.com:/',
            category: '学習',
            isGrowth: true,
            isBlocklisted: false,
            totalSeconds: 90 * 60,
            lastUpdated: '',
          },
          'work.com:/': {
            domain: 'work.com',
            cacheKey: 'work.com:/',
            category: '仕事',
            isGrowth: true,
            isBlocklisted: false,
            totalSeconds: 60 * 60,
            lastUpdated: '',
          },
          'game.com:/': {
            domain: 'game.com',
            cacheKey: 'game.com:/',
            category: '娯楽',
            isGrowth: false,
            isBlocklisted: true,
            totalSeconds: 120 * 60,
            lastUpdated: '',
          },
        },
      }),
    ]
    const report = generateWeeklyReport(history, '2026-W12')
    expect(report.topGrowthDomains).toHaveLength(2)
    expect(report.topGrowthDomains[0]).toEqual({ domain: 'learn.com', minutes: 90 })
    expect(report.topGrowthDomains[1]).toEqual({ domain: 'work.com', minutes: 60 })
  })

  it('Lilyコメントが生成される', () => {
    const history = [
      createMockDailyProgress({
        goodBrowsingSeconds: 120 * 60,
        badBrowsingSeconds: 30 * 60,
      }),
    ]
    const report = generateWeeklyReport(history, '2026-W12')
    expect(report.lilyComment).toBeTruthy()
    expect(typeof report.lilyComment).toBe('string')
  })

  it('generatedAtが設定される', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-21T03:04:05.006Z'))

    const report = generateWeeklyReport([], '2026-W12')
    expect(report.generatedAt).toBe('2026-03-21T12:04:05.006+09:00')
    expect(new Date(report.generatedAt).getTime()).toBe(new Date('2026-03-21T03:04:05.006Z').getTime())
  })
})
