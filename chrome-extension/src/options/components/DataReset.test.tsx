import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setLocal, getLocal } from '@ext/lib/storage'
import { DataReset } from './DataReset'

describe('DataReset', () => {
  beforeEach(async () => {
    await setLocal('dailyProgress', { date: '2026-03-22', goodBrowsingSeconds: 100 })
    await setLocal('dailyProgressHistory', [{ date: '2026-03-21' }])
    await setLocal('classificationCache', { 'example.com:/': {} })
    await setLocal('weeklyReport', { weekKey: '2026-W12' })
  })

  it('リセットボタンを表示する', () => {
    render(<DataReset />)
    expect(screen.getByText('全データをリセット')).toBeDefined()
  })

  it('確認ダイアログで「リセット実行」を押すとストレージが消去される', async () => {
    render(<DataReset />)

    fireEvent.click(screen.getByText('全データをリセット'))
    // 確認UIが表示される
    expect(screen.getByText('リセット実行')).toBeDefined()

    fireEvent.click(screen.getByText('リセット実行'))

    await waitFor(async () => {
      const progress = await getLocal('dailyProgress')
      expect(progress).toBeUndefined()
    })

    const history = await getLocal('dailyProgressHistory')
    expect(history).toBeUndefined()
    const cache = await getLocal('classificationCache')
    expect(cache).toBeUndefined()
    const report = await getLocal('weeklyReport')
    expect(report).toBeUndefined()
  })

  it('確認ダイアログで「キャンセル」を押すとデータは残る', async () => {
    render(<DataReset />)

    fireEvent.click(screen.getByText('全データをリセット'))
    fireEvent.click(screen.getByText('キャンセル'))

    const progress = await getLocal('dailyProgress')
    expect(progress).toBeDefined()
  })
})
