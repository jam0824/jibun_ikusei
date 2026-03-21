import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DailyProgress } from './DailyProgress'
import { createMockDailyProgress } from '@ext/test/helpers'

describe('DailyProgress', () => {
  it('displays good, other, and bad browsing times', () => {
    const progress = createMockDailyProgress({
      goodBrowsingSeconds: 3600,
      otherBrowsingSeconds: 1800,
      badBrowsingSeconds: 600,
    })
    render(<DailyProgress progress={progress} />)

    expect(screen.getByText('1時間0分')).toBeInTheDocument()
    expect(screen.getByText('30分')).toBeInTheDocument()
    expect(screen.getByText('10分')).toBeInTheDocument()
  })

  it('displays quest counts', () => {
    const progress = createMockDailyProgress({
      goodQuestsCleared: 3,
      badQuestsTriggered: 1,
    })
    render(<DailyProgress progress={progress} />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('displays zero state correctly', () => {
    const progress = createMockDailyProgress()
    render(<DailyProgress progress={progress} />)

    const zeroElements = screen.getAllByText('0分')
    expect(zeroElements.length).toBe(3) // good, other, bad all show 0分
  })

  it('shows time remaining to next reward', () => {
    const progress = createMockDailyProgress({
      goodBrowsingSeconds: 20 * 60, // 20 min — 10 min to first reward
      lastGoodRewardAtSeconds: 0,
    })
    render(<DailyProgress progress={progress} />)

    expect(screen.getByText(/次の\+2XPまで/)).toBeInTheDocument()
    expect(screen.getByText(/10分/)).toBeInTheDocument()
  })

  it('バッド閲覧がある場合に次のペナルティまでの残り時間を表示する', () => {
    const progress = createMockDailyProgress({
      badBrowsingSeconds: 40 * 60, // 40分 — 60分ペナルティまで20分
      lastBadPenaltyAtSeconds: 0,
    })
    render(<DailyProgress progress={progress} />)

    expect(screen.getByText(/次のペナルティまで/)).toBeInTheDocument()
    expect(screen.getByText(/20分/)).toBeInTheDocument()
  })

  it('ペナルティ済みの場合は次のペナルティまでの残り時間を表示する', () => {
    const progress = createMockDailyProgress({
      badBrowsingSeconds: 90 * 60, // 90分 — 次は120分
      lastBadPenaltyAtSeconds: 60 * 60,
    })
    render(<DailyProgress progress={progress} />)

    const penaltyEl = screen.getByText(/次のペナルティまで/)
    expect(penaltyEl).toBeInTheDocument()
    expect(penaltyEl.textContent).toContain('30分')
  })

  it('バッド閲覧がない場合はペナルティ残り時間を表示しない', () => {
    const progress = createMockDailyProgress({
      badBrowsingSeconds: 0,
    })
    render(<DailyProgress progress={progress} />)

    expect(screen.queryByText(/次のペナルティまで/)).not.toBeInTheDocument()
  })
})
