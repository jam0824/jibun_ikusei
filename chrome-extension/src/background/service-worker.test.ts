import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocal } from '@ext/lib/storage'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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

  it('FLUSH_AND_GET_PROGRESS で heartbeat を送る', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-17T00:00:00.000Z'))
    vi.mocked(chrome.tabs.query).mockResolvedValue([])
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 1,
      url: 'https://developer.mozilla.org/docs/Web',
      title: 'MDN Web Docs',
    } as chrome.tabs.Tab)

    await import('./service-worker')
    await Promise.resolve()

    const { handlePageInfo } = await import('./message-handler')
    await handlePageInfo(1, {
      domain: 'developer.mozilla.org',
      url: 'https://developer.mozilla.org/docs/Web',
      title: 'MDN Web Docs',
    })

    const activatedListener = vi.mocked(chrome.tabs.onActivated.addListener).mock.calls[0]?.[0]
    await activatedListener?.({ tabId: 1, windowId: 1 })

    vi.mocked(globalThis.fetch).mockClear()
    await vi.advanceTimersByTimeAsync(1000)

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
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body)) as {
      eventType: string
      payload: { tabId: number; title: string | null }
      metadata: { elapsedSeconds: number; trigger: string; category: string | null; isGrowth: boolean | null }
    }
    expect(body.eventType).toBe('heartbeat')
    expect(body.payload).toMatchObject({
      tabId: 1,
      title: 'MDN Web Docs',
    })
    expect(body.metadata).toMatchObject({
      elapsedSeconds: 1,
      trigger: 'flush',
    })
  })
})

describe('browser action-log events', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-17T00:00:00.000Z'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )
  })

  it('sends browser_page_changed on tab activation for active HTTP tabs', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([])
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 10,
      url: 'https://developer.mozilla.org/docs/Web',
      title: 'MDN Web Docs',
      incognito: false,
      active: true,
    } as chrome.tabs.Tab)

    await import('./service-worker')
    await Promise.resolve()

    vi.mocked(globalThis.fetch).mockClear()

    const listener = vi.mocked(chrome.tabs.onActivated.addListener).mock.calls[0]?.[0]
    await listener?.({ tabId: 10, windowId: 1 })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body)) as {
      eventType: string
      payload: { tabId: number; url: string; domain: string; title: string | null }
      metadata: { trigger: string }
    }
    expect(body.eventType).toBe('browser_page_changed')
    expect(body.payload).toEqual({
      tabId: 10,
      url: 'https://developer.mozilla.org/docs/Web',
      domain: 'developer.mozilla.org',
      title: 'MDN Web Docs',
    })
    expect(body.metadata.trigger).toBe('tab_activated')
  })

  it('sends browser_page_changed on active tab URL change', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([])

    await import('./service-worker')
    await Promise.resolve()

    vi.mocked(globalThis.fetch).mockClear()

    const listener = vi.mocked(chrome.tabs.onUpdated.addListener).mock.calls[0]?.[0]
    await listener?.(
      11,
      { url: 'https://react.dev/learn' },
      {
        id: 11,
        url: 'https://react.dev/learn',
        title: 'React Learn',
        active: true,
        incognito: false,
      } as chrome.tabs.Tab,
    )

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body)) as {
      eventType: string
      metadata: { trigger: string }
      payload: { title: string | null }
    }
    expect(body.eventType).toBe('browser_page_changed')
    expect(body.metadata.trigger).toBe('url_changed')
    expect(body.payload.title).toBe('React Learn')
  })

  it('sends browser_page_changed on window focus restore', async () => {
    vi.mocked(chrome.tabs.query).mockImplementation((queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.windowId === 2) {
        return Promise.resolve([
          {
            id: 12,
            url: 'https://example.com/page',
            title: 'Example Page',
            active: true,
            incognito: false,
          } as chrome.tabs.Tab,
        ])
      }
      return Promise.resolve([])
    })

    await import('./service-worker')
    await Promise.resolve()

    vi.mocked(globalThis.fetch).mockClear()

    const listener = vi.mocked(chrome.windows.onFocusChanged.addListener).mock.calls[0]?.[0]
    await listener?.(2)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body)) as {
      eventType: string
      metadata: { trigger: string }
    }
    expect(body.eventType).toBe('browser_page_changed')
    expect(body.metadata.trigger).toBe('window_focus')
  })

  it('sends heartbeat on flush-tracker alarm with elapsedSeconds', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([])
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 13,
      url: 'https://example.com/page',
      title: 'Example Page',
      incognito: false,
    } as chrome.tabs.Tab)

    await import('./service-worker')
    await Promise.resolve()

    const { handlePageInfo } = await import('./message-handler')
    await handlePageInfo(13, {
      domain: 'example.com',
      url: 'https://example.com/page',
      title: 'Example Page',
    })

    const activatedListener = vi.mocked(chrome.tabs.onActivated.addListener).mock.calls[0]?.[0]
    await activatedListener?.({ tabId: 13, windowId: 1 })
    vi.mocked(globalThis.fetch).mockClear()

    await vi.advanceTimersByTimeAsync(30_000)

    const alarmListener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0]?.[0]
    await alarmListener?.({ name: 'flush-tracker', scheduledTime: Date.now() } as chrome.alarms.Alarm)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body)) as {
      eventType: string
      metadata: { trigger: string; elapsedSeconds: number }
    }
    expect(body.eventType).toBe('heartbeat')
    expect(body.metadata.trigger).toBe('flush')
    expect(body.metadata.elapsedSeconds).toBe(30)
  })

  it('skips browser action-log events for incognito tabs', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([])
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 14,
      url: 'https://example.com/private',
      title: 'Private Page',
      incognito: true,
      active: true,
    } as chrome.tabs.Tab)

    await import('./service-worker')
    await Promise.resolve()

    vi.mocked(globalThis.fetch).mockClear()

    const activatedListener = vi.mocked(chrome.tabs.onActivated.addListener).mock.calls[0]?.[0]
    await activatedListener?.({ tabId: 14, windowId: 1 })
    expect(globalThis.fetch).not.toHaveBeenCalled()

    const alarmListener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0]?.[0]
    await alarmListener?.({ name: 'flush-tracker', scheduledTime: Date.now() } as chrome.alarms.Alarm)
    expect(globalThis.fetch).not.toHaveBeenCalled()
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
