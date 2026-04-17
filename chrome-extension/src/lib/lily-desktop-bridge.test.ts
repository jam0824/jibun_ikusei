import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LILY_DESKTOP_BRIDGE_URL,
  sendBrowserHeartbeatToLilyDesktop,
  sendBrowserPageChangedToLilyDesktop,
  sendChromeAudibleTabsToLilyDesktop,
  sendBrowsingSystemMessageToLilyDesktop,
} from '@ext/lib/lily-desktop-bridge'

describe('lily-desktop-bridge', () => {
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sends a good browsing system_message to Lily Desktop', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )

    const ok = await sendBrowsingSystemMessageToLilyDesktop({
      browsingType: 'good',
      xp: 2,
      title: 'Reactチュートリアルを見る',
      domain: 'react.dev',
      category: '学習',
    })

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(LILY_DESKTOP_BRIDGE_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.signal).toBeInstanceOf(AbortSignal)

    const body = JSON.parse(String(init.body)) as {
      eventType: string
      source: string
      eventId: string
      payload: { text: string }
      metadata: Record<string, unknown>
    }

    expect(body).toMatchObject({
      eventType: 'system_message',
      source: 'chrome_extension_browsing',
      eventId: '00000000-0000-4000-8000-000000000000',
      payload: {
        text: '「Reactチュートリアルを見る」で+2 XPをゲットしました。',
      },
      metadata: {
        browsingType: 'good',
        domain: 'react.dev',
        category: '学習',
        xp: 2,
        title: 'Reactチュートリアルを見る',
      },
    })
    expect(body).not.toHaveProperty('occurredAt')
  })

  it('sends a bad browsing system_message with domain fallback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )

    const ok = await sendBrowsingSystemMessageToLilyDesktop({
      browsingType: 'bad',
      xp: -5,
      domain: 'game.com',
      category: '娯楽',
    })

    expect(ok).toBe(true)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      payload: { text: string }
      metadata: Record<string, unknown>
    }

    expect(body.payload.text).toBe('「game.com」で-5 XPのペナルティとなりました。')
    expect(body.metadata).toMatchObject({
      browsingType: 'bad',
      domain: 'game.com',
      category: '娯楽',
      xp: -5,
      title: null,
    })
  })

  it('sends a warning browsing system_message with domain context', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )

    const ok = await sendBrowsingSystemMessageToLilyDesktop({
      browsingType: 'warning',
      xp: 0,
      domain: 'game.com',
      category: '娯楽',
    })

    expect(ok).toBe(true)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      payload: { text: string }
      metadata: Record<string, unknown>
    }

    expect(body.payload.text).toBe('Lily: game.com をあと10分見続けるとペナルティです。')
    expect(body.metadata).toMatchObject({
      browsingType: 'warning',
      domain: 'game.com',
      category: '娯楽',
      xp: 0,
      title: null,
    })
  })

  it('falls back to 閲覧活動 when both title and domain are missing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )

    await sendBrowsingSystemMessageToLilyDesktop({
      browsingType: 'good',
      xp: 2,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { payload: { text: string } }
    expect(body.payload.text).toBe('「閲覧活動」で+2 XPをゲットしました。')
  })

  it('returns false when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'))

    const ok = await sendBrowsingSystemMessageToLilyDesktop({
      browsingType: 'good',
      xp: 2,
      title: '集中タイム',
    })

    expect(ok).toBe(false)
  })

  it('returns false when the bridge responds with a non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 400 }),
    )

    const ok = await sendBrowserPageChangedToLilyDesktop({
      tabId: 99,
      url: 'https://example.com/page',
      domain: 'example.com',
      title: 'Example',
      trigger: 'tab_activated',
      category: null,
      isGrowth: null,
      cacheKey: null,
    })

    expect(ok).toBe(false)
  })

  it('returns false when the bridge request times out', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    }))

    const promise = sendBrowsingSystemMessageToLilyDesktop({
      browsingType: 'good',
      xp: 2,
      title: '集中タイム',
    })

    await vi.advanceTimersByTimeAsync(2000)

    await expect(promise).resolves.toBe(false)
  })

  it('sends a chrome_audible_tabs snapshot to Lily Desktop', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )

    const ok = await sendChromeAudibleTabsToLilyDesktop([
      { tabId: 1, domain: 'www.youtube.com' },
      { tabId: 2, domain: 'netflix.com' },
    ])

    expect(ok).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(LILY_DESKTOP_BRIDGE_URL)

    const body = JSON.parse(String(init.body)) as {
      eventType: string
      source: string
      eventId: string
      payload: { audibleTabs: Array<{ tabId: number; domain: string }> }
    }

    expect(body).toEqual({
      eventType: 'chrome_audible_tabs',
      source: 'chrome_extension_audible_tabs',
      eventId: '00000000-0000-4000-8000-000000000000',
      payload: {
        audibleTabs: [
          { tabId: 1, domain: 'youtube.com' },
          { tabId: 2, domain: 'netflix.com' },
        ],
      },
    })
  })

  it('sends a browser_page_changed event with JST occurredAt and browser metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )

    const ok = await sendBrowserPageChangedToLilyDesktop({
      tabId: 10,
      url: 'https://developer.mozilla.org/docs/Web',
      domain: 'developer.mozilla.org',
      title: 'MDN Web Docs',
      trigger: 'tab_activated',
      category: '学習',
      isGrowth: true,
      cacheKey: 'developer.mozilla.org:/docs/Web',
    })

    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(LILY_DESKTOP_BRIDGE_URL)

    const body = JSON.parse(String(init.body)) as {
      eventType: string
      source: string
      eventId: string
      occurredAt: string
      payload: { tabId: number; url: string; domain: string; title: string | null }
      metadata: Record<string, unknown>
    }

    expect(body).toMatchObject({
      eventType: 'browser_page_changed',
      source: 'chrome_extension',
      eventId: '00000000-0000-4000-8000-000000000000',
      payload: {
        tabId: 10,
        url: 'https://developer.mozilla.org/docs/Web',
        domain: 'developer.mozilla.org',
        title: 'MDN Web Docs',
      },
      metadata: {
        trigger: 'tab_activated',
        category: '学習',
        isGrowth: true,
        cacheKey: 'developer.mozilla.org:/docs/Web',
      },
    })
    expect(body.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/)
  })

  it('sends a heartbeat event with elapsedSeconds metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    )

    const ok = await sendBrowserHeartbeatToLilyDesktop({
      tabId: 22,
      url: 'https://react.dev/learn',
      domain: 'react.dev',
      title: null,
      elapsedSeconds: 30,
      trigger: 'flush',
      category: null,
      isGrowth: null,
      cacheKey: null,
    })

    expect(ok).toBe(true)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      eventType: string
      occurredAt: string
      payload: { title: string | null }
      metadata: Record<string, unknown>
    }

    expect(body.eventType).toBe('heartbeat')
    expect(body.occurredAt).toMatch(/\+09:00$/)
    expect(body.payload.title).toBeNull()
    expect(body.metadata).toMatchObject({
      elapsedSeconds: 30,
      trigger: 'flush',
      category: null,
      isGrowth: null,
      cacheKey: null,
    })
  })
})
