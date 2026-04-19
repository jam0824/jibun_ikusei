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
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({})

      const quest = { id: 'q1', title: 'New Quest', xp: 10 }
      const result = await handler(makeEvent('POST /quests', { body: quest }))
      const { statusCode, body } = parseResponse(result)

      expect(statusCode).toBe(201)
      expect(body.id).toBe('q1')
      expect(body.title).toBe('New Quest')
      expect(body.createdAt).toBeDefined()
      expect(body.updatedAt).toBeDefined()
    })

    it('returns an existing system quest instead of creating a duplicate', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test',
            SK: 'QUEST#q_existing',
            id: 'q_existing',
            title: '食事登録',
            source: 'system',
            systemKey: 'meal_register',
            questType: 'repeatable',
            status: 'active',
            createdAt: '2026-04-19T09:30:00.000+09:00',
            updatedAt: '2026-04-19T09:30:00.000+09:00',
          },
        ],
      })

      const quest = {
        id: 'q_new',
        title: '食事登録',
        source: 'system',
        systemKey: 'meal_register',
        questType: 'repeatable',
        status: 'active',
      }
      const { statusCode, body } = parseResponse(await handler(makeEvent('POST /quests', { body: quest })))

      expect(statusCode).toBe(200)
      expect(body.id).toBe('q_existing')
      expect(mockSend).toHaveBeenCalledTimes(1)
    })

    it('returns an existing legacy sample quest instead of creating a duplicate seed quest', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test',
            SK: 'QUEST#q_existing',
            id: 'q_existing',
            title: '読書する',
            questType: 'repeatable',
            status: 'active',
            createdAt: '2026-04-19T09:30:00.000+09:00',
            updatedAt: '2026-04-19T09:30:00.000+09:00',
          },
        ],
      })

      const quest = {
        id: 'q_new',
        title: '読書する',
        source: 'seed',
        questType: 'repeatable',
        status: 'active',
      }
      const { statusCode, body } = parseResponse(await handler(makeEvent('POST /quests', { body: quest })))

      expect(statusCode).toBe(200)
      expect(body.id).toBe('q_existing')
      expect(mockSend).toHaveBeenCalledTimes(1)
    })

    it('still creates a manual quest even when its title matches a sample quest', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [
            {
              PK: 'user#test',
              SK: 'QUEST#q_existing',
              id: 'q_existing',
              title: '読書する',
              questType: 'repeatable',
              status: 'active',
              createdAt: '2026-04-19T09:30:00.000+09:00',
              updatedAt: '2026-04-19T09:30:00.000+09:00',
            },
          ],
        })
        .mockResolvedValueOnce({})

      const quest = {
        id: 'q_manual',
        title: '読書する',
        source: 'manual',
        questType: 'repeatable',
        status: 'active',
      }
      const { statusCode, body } = parseResponse(await handler(makeEvent('POST /quests', { body: quest })))

      expect(statusCode).toBe(201)
      expect(body.id).toBe('q_manual')
      expect(mockSend).toHaveBeenCalledTimes(1)
    })
  })

  describe('PUT /quests/{id}', () => {
    it('updates a quest', async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: {
            PK: 'user#test',
            SK: 'QUEST#q1',
            id: 'q1',
            title: 'Quest 1',
            questType: 'repeatable',
            status: 'active',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        })
        .mockResolvedValueOnce({})

      const updates = { title: 'Updated Quest' }
      const result = await handler(
        makeEvent('PUT /quests/{id}', { body: updates, pathParameters: { id: 'q1' } })
      )
      const { statusCode, body } = parseResponse(result)

      expect(statusCode).toBe(200)
      expect(body.id).toBe('q1')
      expect(body.title).toBe('Updated Quest')
      expect(body.questType).toBe('repeatable')
      expect(body.status).toBe('active')
      expect(body.createdAt).toBe('2024-01-01T00:00:00.000Z')
      expect(body.updatedAt).toBeDefined()
    })

    it('preserves existing fields when only status is updated', async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: {
            PK: 'user#test',
            SK: 'QUEST#q1',
            id: 'q1',
            title: 'Quest 1',
            description: 'Original description',
            questType: 'one_time',
            status: 'active',
            xpReward: 10,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        })
        .mockResolvedValueOnce({})

      const { statusCode, body } = parseResponse(
        await handler(
          makeEvent('PUT /quests/{id}', {
            body: { status: 'completed' },
            pathParameters: { id: 'q1' },
          })
        )
      )

      expect(statusCode).toBe(200)
      expect(body.id).toBe('q1')
      expect(body.title).toBe('Quest 1')
      expect(body.description).toBe('Original description')
      expect(body.questType).toBe('one_time')
      expect(body.status).toBe('completed')
      expect(body.xpReward).toBe(10)
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
