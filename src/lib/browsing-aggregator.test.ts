import { describe, it, expect } from 'vitest'
import { aggregateDomains, aggregateByCategory, type BrowsingTimeData } from './browsing-aggregator'

const sampleData: BrowsingTimeData[] = [
  {
    date: '2026-03-20',
    domains: {
      'github.com': { totalSeconds: 3600, category: '仕事', isGrowth: true },
      'youtube.com': { totalSeconds: 1800, category: '娯楽', isGrowth: false },
    },
    totalSeconds: 5400,
  },
  {
    date: '2026-03-21',
    domains: {
      'github.com': { totalSeconds: 1800, category: '仕事', isGrowth: true },
      'twitter.com': { totalSeconds: 900, category: '娯楽', isGrowth: false },
    },
    totalSeconds: 2700,
  },
]

describe('aggregateDomains', () => {
  it('複数日のデータを同一ドメインで合算する', () => {
    const result = aggregateDomains(sampleData)
    const github = result.find((d) => d.domain === 'github.com')
    expect(github?.totalSeconds).toBe(5400)
  })

  it('ドメインを閲覧時間降順でソートする', () => {
    const result = aggregateDomains(sampleData)
    expect(result[0].domain).toBe('github.com')
    expect(result[0].totalSeconds).toBeGreaterThanOrEqual(result[1].totalSeconds)
  })

  it('空配列で空配列を返す', () => {
    expect(aggregateDomains([])).toEqual([])
  })

  it('上位N件に制限できる', () => {
    const result = aggregateDomains(sampleData, 2)
    expect(result).toHaveLength(2)
  })

  it('isGrowthとcategoryを保持する', () => {
    const result = aggregateDomains(sampleData)
    const github = result.find((d) => d.domain === 'github.com')
    expect(github?.isGrowth).toBe(true)
    expect(github?.category).toBe('仕事')
  })
})

describe('aggregateByCategory', () => {
  it('カテゴリごとに合計秒数を集計する', () => {
    const result = aggregateByCategory(sampleData)
    const work = result.find((c) => c.category === '仕事')
    expect(work?.totalSeconds).toBe(5400)
  })

  it('カテゴリを閲覧時間降順でソートする', () => {
    const result = aggregateByCategory(sampleData)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].totalSeconds).toBeGreaterThanOrEqual(result[i].totalSeconds)
    }
  })

  it('空配列で空配列を返す', () => {
    expect(aggregateByCategory([])).toEqual([])
  })

  it('isGrowthを保持する', () => {
    const result = aggregateByCategory(sampleData)
    const work = result.find((c) => c.category === '仕事')
    expect(work?.isGrowth).toBe(true)
    const entertainment = result.find((c) => c.category === '娯楽')
    expect(entertainment?.isGrowth).toBe(false)
  })
})
