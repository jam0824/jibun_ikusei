import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeTool, CHAT_TOOLS } from './chat-tools'
import type { BrowsingTimeData } from './api-client'

vi.mock('./api-client', () => ({
  getBrowsingTimes: vi.fn(),
}))

import * as api from './api-client'

const sampleData: BrowsingTimeData[] = [
  {
    date: '2026-03-23',
    domains: {
      'github.com': { totalSeconds: 3600, category: '仕事', isGrowth: true },
      'youtube.com': { totalSeconds: 1800, category: '娯楽', isGrowth: false },
      'udemy.com': { totalSeconds: 2400, category: '学習', isGrowth: true },
    },
    totalSeconds: 7800,
  },
]

const weekData: BrowsingTimeData[] = [
  ...sampleData,
  {
    date: '2026-03-22',
    domains: {
      'github.com': { totalSeconds: 1800, category: '仕事', isGrowth: true },
      'twitter.com': { totalSeconds: 900, category: '娯楽', isGrowth: false },
    },
    totalSeconds: 2700,
  },
]

describe('CHAT_TOOLS', () => {
  it('get_browsing_timesツールが定義されている', () => {
    const tool = CHAT_TOOLS.find((t) => t.function.name === 'get_browsing_times')
    expect(tool).toBeDefined()
    expect(tool?.type).toBe('function')
    expect(tool?.function.parameters.required).toContain('period')
  })
})

describe('executeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Fix "today" for deterministic tests
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T15:00:00+09:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('todayで今日の日付範囲でAPIを呼ぶ', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    await executeTool('get_browsing_times', { period: 'today' })

    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-03-23', '2026-03-23')
  })

  it('weekで直近7日の日付範囲でAPIを呼ぶ', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(weekData)

    await executeTool('get_browsing_times', { period: 'week' })

    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-03-17', '2026-03-23')
  })

  it('monthで直近30日の日付範囲でAPIを呼ぶ', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue([])

    await executeTool('get_browsing_times', { period: 'month' })

    expect(api.getBrowsingTimes).toHaveBeenCalledWith('2026-02-21', '2026-03-23')
  })

  it('カテゴリ別の集計結果を含むテキストを返す', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('仕事')
    expect(result).toContain('娯楽')
    expect(result).toContain('学習')
  })

  it('サイト別の集計結果を含むテキストを返す', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('github.com')
    expect(result).toContain('youtube.com')
    expect(result).toContain('udemy.com')
  })

  it('時間が「X時間Y分」形式で整形される', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue(sampleData)

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('1時間0分')  // github.com 3600s
    expect(result).toContain('30分')       // youtube.com 1800s
  })

  it('データが空の場合に適切なメッセージを返す', async () => {
    vi.mocked(api.getBrowsingTimes).mockResolvedValue([])

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('閲覧データがありません')
  })

  it('未知のツール名でエラー文字列を返す', async () => {
    const result = await executeTool('unknown_tool', {})

    expect(result).toContain('不明なツール')
  })

  it('API呼び出しが失敗した場合にエラー文字列を返す', async () => {
    vi.mocked(api.getBrowsingTimes).mockRejectedValue(new Error('Network error'))

    const result = await executeTool('get_browsing_times', { period: 'today' })

    expect(result).toContain('取得に失敗')
  })
})
