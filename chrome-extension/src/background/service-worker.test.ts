import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('recoverClassifications', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('起動時にアクティブタブへREQUEST_PAGE_INFOを送信する', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 1, url: 'https://www.youtube.com/watch?v=abc' } as chrome.tabs.Tab,
    ])

    const { recoverClassifications } = await import('./service-worker')
    await recoverClassifications()

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'REQUEST_PAGE_INFO' })
  })

  it('chrome://やabout:ページにはリクエストを送信しない', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 2, url: 'chrome://extensions/' } as chrome.tabs.Tab,
    ])

    const { recoverClassifications } = await import('./service-worker')
    await recoverClassifications()

    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('タブIDがない場合はスキップする', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { url: 'https://example.com/' } as chrome.tabs.Tab,
    ])

    const { recoverClassifications } = await import('./service-worker')
    await recoverClassifications()

    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('sendMessageが失敗してもエラーにならない', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 3, url: 'https://example.com/' } as chrome.tabs.Tab,
    ])
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error('No receiving end'))

    const { recoverClassifications } = await import('./service-worker')
    await expect(recoverClassifications()).resolves.toBeUndefined()
  })
})
