import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getIdToken: vi.fn().mockResolvedValue('test-token'),
}))

import { deleteScrap, getScraps, postScrap, putScrap } from './api-client'
import type { ScrapArticle } from '@/domain/types'

const fetchMock = vi.fn<
  (input: string, init?: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }>
>()

function createScrap(): ScrapArticle {
  return {
    id: 'scrap_1',
    url: 'https://example.com/article',
    canonicalUrl: 'https://example.com/article',
    title: 'Example',
    domain: 'example.com',
    status: 'unread',
    addedFrom: 'manual',
    createdAt: '2026-05-01T09:00:00+09:00',
    updatedAt: '2026-05-01T09:00:00+09:00',
  }
}

describe('api-client scraps', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '{}',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('uses the expected scraps paths and payloads', async () => {
    const scrap = createScrap()

    await getScraps()
    await postScrap(scrap)
    await putScrap(scrap.id, { status: 'read' })
    await deleteScrap(scrap.id)

    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/scraps'),
        expect.stringContaining('/scraps'),
        expect.stringContaining('/scraps/scrap_1'),
        expect.stringContaining('/scraps/scrap_1'),
      ]),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/scraps'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(scrap),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/scraps/scrap_1'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ status: 'read' }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/scraps/scrap_1'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
