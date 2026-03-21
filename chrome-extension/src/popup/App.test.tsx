import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { App } from './App'
import { setLocal } from '@ext/lib/storage'
import { createMockDailyProgress, todayString } from '@ext/test/helpers'

describe('Popup App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('今日のDailyProgressがある場合に進捗を表示する', async () => {
    const progress = createMockDailyProgress({
      date: todayString(),
      goodBrowsingSeconds: 30 * 60,
    })
    await setLocal('dailyProgress', progress)

    await act(async () => {
      render(<App />)
    })

    expect(screen.getByText('今日の進捗')).toBeInTheDocument()
    expect(screen.getByText('30分')).toBeInTheDocument()
  })

  it('前日のDailyProgressの場合は「まだデータがありません」を表示する', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const progress = createMockDailyProgress({
      date: yesterday,
      goodBrowsingSeconds: 60 * 60,
    })
    await setLocal('dailyProgress', progress)

    await act(async () => {
      render(<App />)
    })

    expect(screen.getByText('まだデータがありません')).toBeInTheDocument()
  })

  it('ストレージ変更時にPopupが再レンダリングされる', async () => {
    const progress = createMockDailyProgress({
      date: todayString(),
      goodBrowsingSeconds: 0,
    })
    await setLocal('dailyProgress', progress)

    await act(async () => {
      render(<App />)
    })

    expect(screen.getAllByText('0分').length).toBeGreaterThanOrEqual(1)

    // onChanged コールバックを取得して呼ぶ
    const addListenerCalls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls
    expect(addListenerCalls.length).toBeGreaterThanOrEqual(1)
    const listener = addListenerCalls[0][0] as (
      changes: Record<string, { newValue?: unknown }>,
    ) => void

    // ストレージ変更をシミュレート
    const updatedProgress = createMockDailyProgress({
      date: todayString(),
      goodBrowsingSeconds: 45 * 60,
    })

    await act(async () => {
      listener({ dailyProgress: { newValue: updatedProgress } })
    })

    expect(screen.getByText('45分')).toBeInTheDocument()
  })

  it('アンマウント時にonChangedリスナーを解除する', async () => {
    await setLocal('dailyProgress', createMockDailyProgress({ date: todayString() }))

    let unmount: () => void
    await act(async () => {
      const result = render(<App />)
      unmount = result.unmount
    })

    await act(async () => {
      unmount()
    })

    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalled()
  })
})
