import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RESET_EXTENSION_DATA_KEYS } from '@ext/background/reset-state'
import { getLocal, setLocal } from '@ext/lib/storage'
import { DataReset } from './DataReset'

describe('DataReset', () => {
  beforeEach(async () => {
    await setLocal('dailyProgress', { date: '2026-03-22', goodBrowsingSeconds: 100 })
    await setLocal('dailyProgressHistory', [{ date: '2026-03-21' }])
    await setLocal('classificationCache', { 'example.com:/': {} })
    await setLocal('weeklyReport', { weekKey: '2026-W12' })
    await setLocal('syncQueue', [{ path: '/quests', method: 'POST', body: {} }])
    await setLocal('activityLogBuffer', [{ action: 'test' }])
    await setLocal('browsingTimeSyncBacklog', { '2026-03-20': { date: '2026-03-20', domains: {}, totalSeconds: 0 } })

    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message: unknown) => {
      if ((message as { type?: string }).type === 'RESET_EXTENSION_DATA') {
        await chrome.storage.local.remove([...RESET_EXTENSION_DATA_KEYS])
        return { ok: true }
      }
      return { ok: false }
    })
  })

  it('リセットボタンを表示する', () => {
    render(<DataReset />)
    expect(screen.getByText('全データをリセット')).toBeDefined()
  })

  it('確認ダイアログで「リセット実行」を押すとストレージが消去される', async () => {
    render(<DataReset />)

    fireEvent.click(screen.getByText('全データをリセット'))
    expect(screen.getByText('リセット実行')).toBeDefined()

    fireEvent.click(screen.getByText('リセット実行'))

    await waitFor(async () => {
      const progress = await getLocal('dailyProgress')
      expect(progress).toBeUndefined()
    })

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RESET_EXTENSION_DATA' })
    expect(await getLocal('dailyProgressHistory')).toBeUndefined()
    expect(await getLocal('classificationCache')).toBeUndefined()
    expect(await getLocal('weeklyReport')).toBeUndefined()
    expect(await getLocal('syncQueue')).toBeUndefined()
    expect(await getLocal('activityLogBuffer')).toBeUndefined()
    expect(await getLocal('browsingTimeSyncBacklog')).toBeUndefined()
  })

  it('確認ダイアログで「キャンセル」を押すとデータは残る', async () => {
    render(<DataReset />)

    fireEvent.click(screen.getByText('全データをリセット'))
    fireEvent.click(screen.getByText('キャンセル'))

    const progress = await getLocal('dailyProgress')
    expect(progress).toBeDefined()
  })
})
