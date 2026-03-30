import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocal } from '@ext/lib/storage'

describe('recoverClassifications', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('active な HTTP タブへ REQUEST_PAGE_INFO を送る', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 1, url: 'https://www.youtube.com/watch?v=abc' } as chrome.tabs.Tab,
    ])

    const { recoverClassifications } = await import('./service-worker')
    await recoverClassifications()

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'REQUEST_PAGE_INFO' })
  })

  it('chrome:// や about: ページにはリクエストしない', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 2, url: 'chrome://extensions/' } as chrome.tabs.Tab,
    ])

    const { recoverClassifications } = await import('./service-worker')
    await recoverClassifications()

    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('タブ ID がない場合はスキップする', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { url: 'https://example.com/' } as chrome.tabs.Tab,
    ])

    const { recoverClassifications } = await import('./service-worker')
    await recoverClassifications()

    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('sendMessage 失敗でもエラーにしない', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 3, url: 'https://example.com/' } as chrome.tabs.Tab,
    ])
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error('No receiving end'))

    const { recoverClassifications } = await import('./service-worker')
    await expect(recoverClassifications()).resolves.toBeUndefined()
  })
})

describe('recoverTabTracking', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('HTTP タブが存在するとき復元処理をしてもエラーにならない', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 1, url: 'https://www.youtube.com/' } as chrome.tabs.Tab,
    ])

    const { recoverTabTracking } = await import('./service-worker')
    await expect(recoverTabTracking()).resolves.toBeUndefined()
  })

  it('chrome:// タブは無視する', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 2, url: 'chrome://extensions/' } as chrome.tabs.Tab,
    ])

    const { recoverTabTracking } = await import('./service-worker')
    await expect(recoverTabTracking()).resolves.toBeUndefined()
  })

  it('アクティブタブがない場合はスキップする', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([])

    const { recoverTabTracking } = await import('./service-worker')
    await expect(recoverTabTracking()).resolves.toBeUndefined()
  })

  it('tabs.query 失敗でもエラーにならない', async () => {
    vi.mocked(chrome.tabs.query).mockRejectedValue(new Error('tabs API error'))

    const { recoverTabTracking } = await import('./service-worker')
    await expect(recoverTabTracking()).resolves.toBeUndefined()
  })
})

describe('message handling', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('FLUSH_AND_GET_PROGRESS で当日進捗を作成して ok を返す', async () => {
    await import('./service-worker')

    const listeners = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.map(([listener]) => listener)
    const response = await new Promise<unknown>((resolve) => {
      for (const listener of listeners) {
        const keepAlive = listener(
          { type: 'FLUSH_AND_GET_PROGRESS' },
          {} as chrome.runtime.MessageSender,
          resolve,
        ) as unknown

        if (keepAlive === true) {
          return
        }
      }
    })

    expect(response).toEqual({ ok: true })
    expect(await getLocal('dailyProgress')).toBeDefined()
  })
})
