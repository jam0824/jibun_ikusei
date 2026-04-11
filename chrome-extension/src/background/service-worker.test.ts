import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocal } from '@ext/lib/storage'

describe('recoverClassifications', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )
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

describe('audible tab sync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )
  })

  it('startup sync sends a chrome_audible_tabs snapshot for HTTP audible tabs', async () => {
    vi.mocked(chrome.tabs.query).mockImplementation((queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.audible) {
        return Promise.resolve([
          { id: 1, url: 'https://www.youtube.com/watch?v=abc', audible: true } as chrome.tabs.Tab,
        ])
      }
      return Promise.resolve([
        { id: 1, url: 'https://www.youtube.com/watch?v=abc' } as chrome.tabs.Tab,
      ])
    })

    await import('./service-worker')
    await Promise.resolve()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18765/v1/events',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body)) as {
      eventType: string
      payload: { audibleTabs: Array<{ tabId: number; domain: string }> }
    }
    expect(body.eventType).toBe('chrome_audible_tabs')
    expect(body.payload.audibleTabs).toEqual([{ tabId: 1, domain: 'youtube.com' }])
  })

  it('onUpdated with audible change sends an empty snapshot when audible tabs disappear', async () => {
    let audibleTabs: chrome.tabs.Tab[] = [
      { id: 1, url: 'https://www.youtube.com/watch?v=abc', audible: true } as chrome.tabs.Tab,
    ]
    vi.mocked(chrome.tabs.query).mockImplementation((queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.audible) {
        return Promise.resolve(audibleTabs)
      }
      return Promise.resolve([])
    })

    await import('./service-worker')
    await Promise.resolve()

    audibleTabs = []
    const listener = vi.mocked(chrome.tabs.onUpdated.addListener).mock.calls[0]?.[0]
    await listener?.(1, { audible: false }, { id: 1 } as chrome.tabs.Tab)

    const calls = vi.mocked(globalThis.fetch).mock.calls
    const lastBody = JSON.parse(String(calls[calls.length - 1]?.[1]?.body)) as {
      payload: { audibleTabs: Array<unknown> }
    }
    expect(lastBody.payload.audibleTabs).toEqual([])
  })

  it('flush-tracker alarm sends heartbeat while audible tabs exist', async () => {
    vi.mocked(chrome.tabs.query).mockImplementation((queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.audible) {
        return Promise.resolve([
          { id: 1, url: 'https://netflix.com/watch/1', audible: true } as chrome.tabs.Tab,
        ])
      }
      return Promise.resolve([])
    })

    await import('./service-worker')
    await Promise.resolve()
    vi.mocked(globalThis.fetch).mockClear()

    const listener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0]?.[0]
    await listener?.({ name: 'flush-tracker', scheduledTime: Date.now() } as chrome.alarms.Alarm)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body)) as {
      payload: { audibleTabs: Array<{ tabId: number; domain: string }> }
    }
    expect(body.payload.audibleTabs).toEqual([{ tabId: 1, domain: 'netflix.com' }])
  })

  it('onRemoved recalculates audible tabs and sends the updated snapshot', async () => {
    let audibleTabs: chrome.tabs.Tab[] = [
      { id: 1, url: 'https://www.youtube.com/watch?v=abc', audible: true } as chrome.tabs.Tab,
      { id: 2, url: 'https://primevideo.com/detail/xyz', audible: true } as chrome.tabs.Tab,
    ]
    vi.mocked(chrome.tabs.query).mockImplementation((queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.audible) {
        return Promise.resolve(audibleTabs)
      }
      return Promise.resolve([])
    })

    await import('./service-worker')
    await Promise.resolve()

    audibleTabs = [
      { id: 2, url: 'https://primevideo.com/detail/xyz', audible: true } as chrome.tabs.Tab,
    ]
    const listener = vi.mocked(chrome.tabs.onRemoved.addListener).mock.calls[0]?.[0]
    await listener?.(1, { windowId: 1, isWindowClosing: false })

    const calls = vi.mocked(globalThis.fetch).mock.calls
    const lastBody = JSON.parse(String(calls[calls.length - 1]?.[1]?.body)) as {
      payload: { audibleTabs: Array<{ tabId: number; domain: string }> }
    }
    expect(lastBody.payload.audibleTabs).toEqual([{ tabId: 2, domain: 'primevideo.com' }])
  })
})
