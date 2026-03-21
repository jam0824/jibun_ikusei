import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../skillHandler/index.mjs'

describe('skillHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('GET /skills', () => {
    it('returns skills without PK/SK', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'user#test', SK: 'SKILL#s1', id: 's1', name: 'JavaScript' },
        ],
      })

      const { statusCode, body } = parseResponse(await handler(makeEvent('GET /skills')))
      expect(statusCode).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0]).toEqual({ id: 's1', name: 'JavaScript' })
    })
  })

  describe('POST /skills', () => {
    it('creates a skill', async () => {
      mockSend.mockResolvedValueOnce({})

      const skill = { id: 's1', name: 'TypeScript', totalXp: 0 }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('POST /skills', { body: skill }))
      )

      expect(statusCode).toBe(201)
      expect(body.id).toBe('s1')
      expect(body.name).toBe('TypeScript')
      expect(body.createdAt).toBeDefined()
      expect(body.updatedAt).toBeDefined()
    })
  })

  describe('PUT /skills/{id}', () => {
    it('updates a skill', async () => {
      mockSend.mockResolvedValueOnce({})

      const updates = { name: 'Advanced TS', totalXp: 100 }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('PUT /skills/{id}', { body: updates, pathParameters: { id: 's1' } }))
      )

      expect(statusCode).toBe(200)
      expect(body.id).toBe('s1')
      expect(body.name).toBe('Advanced TS')
      expect(body.updatedAt).toBeDefined()
    })
  })

  it('returns 400 for unknown route', async () => {
    const result = await handler(makeEvent('DELETE /skills/{id}'))
    expect(result.statusCode).toBe(400)
  })
})
