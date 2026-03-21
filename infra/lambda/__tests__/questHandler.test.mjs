import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../questHandler/index.mjs'

describe('questHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('GET /quests', () => {
    it('returns quests without PK/SK', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'user#test', SK: 'QUEST#q1', id: 'q1', title: 'Quest 1' },
          { PK: 'user#test', SK: 'QUEST#q2', id: 'q2', title: 'Quest 2' },
        ],
      })

      const result = await handler(makeEvent('GET /quests'))
      const { statusCode, body } = parseResponse(result)

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(2)
      expect(body[0]).toEqual({ id: 'q1', title: 'Quest 1' })
      expect(body[1]).toEqual({ id: 'q2', title: 'Quest 2' })
    })

    it('returns empty array when no quests', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] })

      const { body } = parseResponse(await handler(makeEvent('GET /quests')))
      expect(body).toEqual([])
    })
  })

  describe('POST /quests', () => {
    it('creates a quest and returns 201', async () => {
      mockSend.mockResolvedValueOnce({})

      const quest = { id: 'q1', title: 'New Quest', xp: 10 }
      const result = await handler(makeEvent('POST /quests', { body: quest }))
      const { statusCode, body } = parseResponse(result)

      expect(statusCode).toBe(201)
      expect(body.id).toBe('q1')
      expect(body.title).toBe('New Quest')
      expect(body.createdAt).toBeDefined()
      expect(body.updatedAt).toBeDefined()
    })
  })

  describe('PUT /quests/{id}', () => {
    it('updates a quest', async () => {
      mockSend.mockResolvedValueOnce({})

      const updates = { title: 'Updated Quest' }
      const result = await handler(
        makeEvent('PUT /quests/{id}', { body: updates, pathParameters: { id: 'q1' } })
      )
      const { statusCode, body } = parseResponse(result)

      expect(statusCode).toBe(200)
      expect(body.id).toBe('q1')
      expect(body.title).toBe('Updated Quest')
      expect(body.updatedAt).toBeDefined()
    })
  })

  describe('DELETE /quests/{id}', () => {
    it('deletes a quest', async () => {
      mockSend.mockResolvedValueOnce({})

      const result = await handler(
        makeEvent('DELETE /quests/{id}', { pathParameters: { id: 'q1' } })
      )
      const { statusCode, body } = parseResponse(result)

      expect(statusCode).toBe(200)
      expect(body.deleted).toBe('q1')
    })
  })

  it('returns 400 for unknown route', async () => {
    const result = await handler(makeEvent('PATCH /quests'))
    expect(result.statusCode).toBe(400)
  })
})
