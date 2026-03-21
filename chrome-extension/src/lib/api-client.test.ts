import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ext/lib/auth', () => ({
  getStoredToken: vi.fn().mockResolvedValue('test-jwt-token'),
}))

import { createApiClient } from '@ext/lib/api-client'

describe('api-client', () => {
  let client: ReturnType<typeof createApiClient>

  beforeEach(async () => {
    // Store server URL in chrome.storage.local
    await chrome.storage.local.set({
      extensionSettings: {
        serverBaseUrl: 'https://api.example.com',
      },
    })
    client = createApiClient()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes auth token in Authorization header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ level: 1, totalXp: 50 }), { status: 200 }),
    )

    await client.getUser()

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer test-jwt-token',
    )
  })

  it('sends PUT request with correct body for XP update', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ updated: true }), { status: 200 }),
    )

    await client.putUser({ totalXp: 52 })

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/user')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body as string)).toEqual({ totalXp: 52 })
  })

  it('throws on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    )

    await expect(client.getUser()).rejects.toThrow('API error: 404')
  })

  it('constructs correct URL for endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    )

    await client.getCompletions()

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://api.example.com/completions')
  })
})
