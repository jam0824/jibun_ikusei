import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../messageHandler/index.mjs'

describe('messageHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('/messages', () => {
    it('GET returns messages without PK/SK', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'user#test', SK: 'MSG#m1', id: 'm1', text: 'Hello' },
        ],
      })

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('GET /messages'))
      )
      expect(statusCode).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0]).toEqual({ id: 'm1', text: 'Hello' })
    })

    it('POST creates a message', async () => {
      mockSend.mockResolvedValueOnce({})

      const msg = { id: 'm1', text: 'New message' }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('POST /messages', { body: msg }))
      )
      expect(statusCode).toBe(201)
      expect(body.id).toBe('m1')
      expect(body.createdAt).toBeDefined()
    })
  })

  describe('/dictionary', () => {
    it('GET returns dictionary entries', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'user#test', SK: 'DICT#d1', id: 'd1', term: 'Test' },
        ],
      })

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('GET /dictionary'))
      )
      expect(statusCode).toBe(200)
      expect(body[0]).toEqual({ id: 'd1', term: 'Test' })
    })

    it('POST creates a dictionary entry', async () => {
      mockSend.mockResolvedValueOnce({})

      const entry = { id: 'd1', term: 'New Term' }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('POST /dictionary', { body: entry }))
      )
      expect(statusCode).toBe(201)
      expect(body.id).toBe('d1')
    })

    it('PUT updates a dictionary entry', async () => {
      mockSend.mockResolvedValueOnce({})

      const updates = { term: 'Updated Term' }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('PUT /dictionary/{id}', { body: updates, pathParameters: { id: 'd1' } }))
      )
      expect(statusCode).toBe(200)
      expect(body.id).toBe('d1')
      expect(body.term).toBe('Updated Term')
    })
  })

  it('returns 400 for unknown route', async () => {
    const result = await handler(makeEvent('GET /unknown'))
    expect(result.statusCode).toBe(400)
  })
})
