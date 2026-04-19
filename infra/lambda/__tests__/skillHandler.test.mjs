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

    it('returns an existing active duplicate skill instead of creating a second one', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test',
            SK: 'SKILL#s_existing',
            id: 's_existing',
            name: '読書',
            normalizedName: '読書',
            category: '学習',
            totalXp: 12,
            level: 1,
            source: 'seed',
            status: 'active',
            createdAt: '2026-04-19T09:30:00.000+09:00',
            updatedAt: '2026-04-19T09:30:00.000+09:00',
          },
        ],
      })

      const skill = { id: 's_new', name: ' 読 書 ', totalXp: 0, category: '学習', status: 'active' }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('POST /skills', { body: skill }))
      )

      expect(statusCode).toBe(200)
      expect(body.id).toBe('s_existing')
      expect(body.name).toBe('読書')
      expect(mockSend).toHaveBeenCalledTimes(1)
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
