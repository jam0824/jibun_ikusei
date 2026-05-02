import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../scrapHandler/index.mjs'

describe('scrapHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  it('GET /scraps returns scraps without PK/SK', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: 'user#test', SK: 'SCRAP#s1', id: 's1', title: 'Article', canonicalUrl: 'https://example.com/a' },
      ],
    })

    const { statusCode, body } = parseResponse(await handler(makeEvent('GET /scraps')))

    expect(statusCode).toBe(200)
    expect(body).toEqual([{ id: 's1', title: 'Article', canonicalUrl: 'https://example.com/a' }])
  })

  it('POST /scraps creates a scrap when canonicalUrl is new', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})

    const scrap = {
      id: 's1',
      url: 'https://example.com/a',
      canonicalUrl: 'https://example.com/a',
      title: 'Article',
      domain: 'example.com',
      status: 'unread',
      addedFrom: 'manual',
      createdAt: '2026-05-01T09:00:00+09:00',
      updatedAt: '2026-05-01T09:00:00+09:00',
    }
    const { statusCode, body } = parseResponse(await handler(makeEvent('POST /scraps', { body: scrap })))

    expect(statusCode).toBe(201)
    expect(body).toMatchObject({ ...scrap, updatedAt: expect.stringMatching(/\+09:00$/) })
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it('POST /scraps returns an existing duplicate instead of writing', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'user#test',
          SK: 'SCRAP#existing',
          id: 'existing',
          canonicalUrl: 'https://example.com/a',
          title: 'Existing',
        },
      ],
    })

    const { statusCode, body } = parseResponse(
      await handler(
        makeEvent('POST /scraps', {
          body: {
            id: 's1',
            url: 'https://example.com/a',
            canonicalUrl: 'https://example.com/a',
            title: 'Article',
            domain: 'example.com',
          },
        }),
      ),
    )

    expect(statusCode).toBe(200)
    expect(body.id).toBe('existing')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('POST /scraps rejects invalid URLs', async () => {
    const { statusCode, body } = parseResponse(
      await handler(
        makeEvent('POST /scraps', {
          body: {
            id: 's1',
            url: 'ftp://example.com/a',
            canonicalUrl: 'ftp://example.com/a',
            title: 'Article',
            domain: 'example.com',
          },
        }),
      ),
    )

    expect(statusCode).toBe(400)
    expect(body.error).toBe('保存できるURLではありません。')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('PUT /scraps/{id} updates status timestamps in JST', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          PK: 'user#test',
          SK: 'SCRAP#s1',
          id: 's1',
          url: 'https://example.com/a',
          canonicalUrl: 'https://example.com/a',
          title: 'Article',
          domain: 'example.com',
          status: 'unread',
          addedFrom: 'manual',
          createdAt: '2026-05-01T09:00:00+09:00',
          updatedAt: '2026-05-01T09:00:00+09:00',
        },
      })
      .mockResolvedValueOnce({})

    const { statusCode, body } = parseResponse(
      await handler(
        makeEvent('PUT /scraps/{id}', {
          pathParameters: { id: 's1' },
          body: { status: 'read' },
        }),
      ),
    )

    expect(statusCode).toBe(200)
    expect(body.status).toBe('read')
    expect(body.readAt).toMatch(/\+09:00$/)
    expect(body.updatedAt).toMatch(/\+09:00$/)
  })

  it('DELETE /scraps/{id} deletes a scrap', async () => {
    mockSend.mockResolvedValueOnce({})

    const { statusCode, body } = parseResponse(
      await handler(makeEvent('DELETE /scraps/{id}', { pathParameters: { id: 's1' } })),
    )

    expect(statusCode).toBe(200)
    expect(body).toEqual({ deleted: 's1' })
  })
})
