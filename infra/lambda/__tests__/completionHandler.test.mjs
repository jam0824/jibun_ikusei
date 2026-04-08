import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../completionHandler/index.mjs'

describe('completionHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('GET /completions', () => {
    it('returns completions without PK/SK', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'user#test', SK: 'COMPLETION#c1', id: 'c1', questId: 'q1' },
        ],
      })

      const { statusCode, body } = parseResponse(await handler(makeEvent('GET /completions')))
      expect(statusCode).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0]).toEqual({ id: 'c1', questId: 'q1' })
    })
  })

  describe('POST /completions', () => {
    it('creates completion and updates user XP', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: 'QUEST#q1', id: 'q1', title: 'Quest 1', status: 'active' },
        })
        .mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: 'USER#profile', totalXp: 50, level: 1, createdAt: '2024-01-01' },
        })
        .mockResolvedValueOnce({})

      const body = { id: 'c1', questId: 'q1', userXpAwarded: 10 }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /completions', { body }))
      )

      expect(statusCode).toBe(201)
      expect(resBody.totalXp).toBe(60)
      expect(resBody.userXpAwarded).toBe(10)
      expect(resBody.userLevelUp).toBe(false)
    })

    it('detects user level up', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: 'QUEST#q1', id: 'q1', title: 'Quest 1', status: 'active' },
        })
        .mockResolvedValueOnce({
          Item: { totalXp: 95, level: 1, createdAt: '2024-01-01' },
        })
        .mockResolvedValueOnce({})

      const body = { id: 'c2', questId: 'q1', userXpAwarded: 10 }
      const { body: resBody } = parseResponse(
        await handler(makeEvent('POST /completions', { body }))
      )

      expect(resBody.totalXp).toBe(105)
      expect(resBody.level).toBe(2)
      expect(resBody.userLevelUp).toBe(true)
    })

    it('updates skill XP when resolvedSkillId provided', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: 'QUEST#q1', id: 'q1', title: 'Quest 1', status: 'active' },
        })
        .mockResolvedValueOnce({
          Item: { totalXp: 0, level: 1, createdAt: '2024-01-01' },
        })
        .mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: 'SKILL#s1', id: 's1', name: 'JS', totalXp: 40, level: 1 },
        })
        .mockResolvedValueOnce({})

      const body = { id: 'c3', questId: 'q1', userXpAwarded: 5, resolvedSkillId: 's1', skillXpAwarded: 15 }
      const { body: resBody } = parseResponse(
        await handler(makeEvent('POST /completions', { body }))
      )

      expect(resBody.skillLevelUp).toBe(true)
    })

    it('handles new user with no existing profile', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: 'QUEST#q1', id: 'q1', title: 'Quest 1', status: 'active' },
        })
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({})

      const body = { id: 'c4', questId: 'q1', userXpAwarded: 10 }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /completions', { body }))
      )

      expect(statusCode).toBe(201)
      expect(resBody.totalXp).toBe(10)
      expect(resBody.level).toBe(1)
    })

    it('rejects completions that reference a missing quest', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Item: undefined })

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('POST /completions', { body: { id: 'c5', questId: 'missing', userXpAwarded: 5 } }))
      )

      expect(statusCode).toBe(400)
      expect(body.error).toBe('クエストが見つからないか、完了できない状態です。')
    })
  })

  describe('PUT /completions/{id}', () => {
    it('merges updates with existing completion', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { PK: 'user#test', SK: 'COMPLETION#c1', id: 'c1', questId: 'q1', xp: 10 },
      })
      mockSend.mockResolvedValueOnce({})

      const updates = { undoneAt: '2024-06-01' }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('PUT /completions/{id}', { body: updates, pathParameters: { id: 'c1' } }))
      )

      expect(statusCode).toBe(200)
      expect(body.id).toBe('c1')
      expect(body.questId).toBe('q1')
      expect(body.undoneAt).toBe('2024-06-01')
    })
  })

  it('returns 400 for unknown route', async () => {
    const result = await handler(makeEvent('PATCH /completions'))
    expect(result.statusCode).toBe(400)
  })
})
