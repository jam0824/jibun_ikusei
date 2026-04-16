import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../completionHandler/index.mjs'

function mockAggregateLoad({ completions = [], skills = [], user = undefined } = {}) {
  mockSend
    .mockResolvedValueOnce({ Items: completions })
    .mockResolvedValueOnce({ Items: skills })
    .mockResolvedValueOnce({ Item: user })
}

function getPutItems() {
  return mockSend.mock.calls
    .map(([command]) => command.input?.Item)
    .filter(Boolean)
}

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
      mockAggregateLoad({
        completions: [
          { id: 'c0', questId: 'q0', userXpAwarded: 50, createdAt: '2024-01-01T00:00:00.000Z' },
        ],
        skills: [],
        user: { PK: 'user#test', SK: 'USER#profile', totalXp: 50, level: 1, createdAt: '2024-01-01' },
      })
      mockSend
        .mockResolvedValueOnce({})
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
      mockAggregateLoad({
        completions: [
          { id: 'c0', questId: 'q0', userXpAwarded: 95, createdAt: '2024-01-01T00:00:00.000Z' },
        ],
        skills: [],
        user: { totalXp: 95, level: 1, createdAt: '2024-01-01' },
      })
      mockSend
        .mockResolvedValueOnce({})
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
      mockAggregateLoad({
        completions: [
          {
            id: 'c0',
            questId: 'q0',
            userXpAwarded: 0,
            resolvedSkillId: 's1',
            skillXpAwarded: 40,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        skills: [
          { PK: 'user#test', SK: 'SKILL#s1', id: 's1', name: 'JS', totalXp: 40, level: 1, createdAt: '2024-01-01' },
        ],
        user: { totalXp: 0, level: 1, createdAt: '2024-01-01' },
      })
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
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
      mockAggregateLoad({
        completions: [],
        skills: [],
        user: undefined,
      })
      mockSend
        .mockResolvedValueOnce({})
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

    it('recalculates user and skill totals from completions instead of stored aggregates', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: 'QUEST#q1', id: 'q1', title: 'Quest 1', status: 'active' },
        })
      mockAggregateLoad({
        completions: [
          {
            id: 'c0',
            questId: 'q0',
            userXpAwarded: 95,
            resolvedSkillId: 's1',
            skillXpAwarded: 90,
            createdAt: '2026-04-16T08:00:00.000Z',
          },
        ],
        skills: [
          {
            PK: 'user#test',
            SK: 'SKILL#s1',
            id: 's1',
            name: 'Health',
            totalXp: 10,
            level: 1,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
          },
        ],
        user: {
          PK: 'user#test',
          SK: 'USER#profile',
          id: 'local_user',
          totalXp: 50,
          level: 1,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-10T00:00:00.000Z',
        },
      })
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})

      const body = { id: 'c6', questId: 'q1', userXpAwarded: 10, resolvedSkillId: 's1', skillXpAwarded: 10 }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /completions', { body }))
      )

      expect(statusCode).toBe(201)
      expect(resBody.totalXp).toBe(105)
      expect(resBody.level).toBe(2)
      expect(resBody.skillLevelUp).toBe(true)
      expect(getPutItems()).toEqual(expect.arrayContaining([
        expect.objectContaining({ SK: 'USER#profile', totalXp: 105, level: 2 }),
        expect.objectContaining({ SK: 'SKILL#s1', totalXp: 100, level: 3 }),
      ]))
    })

    it('keeps idempotent POST responses aligned with recalculated aggregates', async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: 'COMPLETION#c7', id: 'c7', questId: 'q1', userXpAwarded: 10 },
        })
      mockAggregateLoad({
        completions: [
          { id: 'c0', questId: 'q0', userXpAwarded: 95, createdAt: '2026-04-16T08:00:00.000Z' },
          { id: 'c7', questId: 'q1', userXpAwarded: 10, createdAt: '2026-04-16T09:00:00.000Z' },
        ],
        skills: [],
        user: {
          PK: 'user#test',
          SK: 'USER#profile',
          id: 'local_user',
          totalXp: 50,
          level: 1,
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      })
      mockSend.mockResolvedValueOnce({})

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('POST /completions', { body: { id: 'c7', questId: 'q1', userXpAwarded: 10 } }))
      )

      expect(statusCode).toBe(201)
      expect(body.totalXp).toBe(105)
      expect(body.level).toBe(2)
      expect(body.userLevelUp).toBe(false)
      expect(getPutItems()).toEqual(expect.arrayContaining([
        expect.objectContaining({ SK: 'USER#profile', totalXp: 105, level: 2 }),
      ]))
    })
  })

  describe('PUT /completions/{id}', () => {
    it('merges updates with existing completion', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { PK: 'user#test', SK: 'COMPLETION#c1', id: 'c1', questId: 'q1', xp: 10 },
      })
      mockAggregateLoad({
        completions: [{ id: 'c1', questId: 'q1', xp: 10 }],
        skills: [],
        user: undefined,
      })
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})

      const updates = { undoneAt: '2024-06-01' }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('PUT /completions/{id}', { body: updates, pathParameters: { id: 'c1' } }))
      )

      expect(statusCode).toBe(200)
      expect(body.id).toBe('c1')
      expect(body.questId).toBe('q1')
      expect(body.undoneAt).toBe('2024-06-01')
    })

    it('recalculates skill totals when a resolved skill is assigned later', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'user#test',
          SK: 'COMPLETION#c1',
          id: 'c1',
          questId: 'q1',
          userXpAwarded: 10,
          createdAt: '2026-04-16T09:00:00.000Z',
        },
      })
      mockAggregateLoad({
        completions: [
          {
            id: 'c0',
            questId: 'q0',
            userXpAwarded: 20,
            resolvedSkillId: 's1',
            skillXpAwarded: 190,
            createdAt: '2026-04-16T08:00:00.000Z',
          },
          {
            id: 'c1',
            questId: 'q1',
            userXpAwarded: 10,
            createdAt: '2026-04-16T09:00:00.000Z',
          },
        ],
        skills: [
          {
            PK: 'user#test',
            SK: 'SKILL#s1',
            id: 's1',
            name: 'Health',
            totalXp: 190,
            level: 4,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-16T08:00:00.000Z',
          },
        ],
        user: {
          PK: 'user#test',
          SK: 'USER#profile',
          id: 'local_user',
          totalXp: 30,
          level: 1,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-16T08:00:00.000Z',
        },
      })
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})

      const updates = { resolvedSkillId: 's1', skillXpAwarded: 10, skillResolutionStatus: 'resolved' }
      const { statusCode, body } = parseResponse(
        await handler(makeEvent('PUT /completions/{id}', { body: updates, pathParameters: { id: 'c1' } }))
      )

      expect(statusCode).toBe(200)
      expect(body.resolvedSkillId).toBe('s1')
      expect(getPutItems()).toEqual(expect.arrayContaining([
        expect.objectContaining({ SK: 'SKILL#s1', totalXp: 200, level: 5 }),
      ]))
    })

    it('subtracts user and skill totals when a completion is undone', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'user#test',
          SK: 'COMPLETION#c1',
          id: 'c1',
          questId: 'q1',
          userXpAwarded: 10,
          resolvedSkillId: 's1',
          skillXpAwarded: 10,
          createdAt: '2026-04-16T09:00:00.000Z',
        },
      })
      mockAggregateLoad({
        completions: [
          {
            id: 'c0',
            questId: 'q0',
            userXpAwarded: 20,
            resolvedSkillId: 's1',
            skillXpAwarded: 40,
            createdAt: '2026-04-16T08:00:00.000Z',
          },
          {
            id: 'c1',
            questId: 'q1',
            userXpAwarded: 10,
            resolvedSkillId: 's1',
            skillXpAwarded: 10,
            createdAt: '2026-04-16T09:00:00.000Z',
          },
        ],
        skills: [
          {
            PK: 'user#test',
            SK: 'SKILL#s1',
            id: 's1',
            name: 'Health',
            totalXp: 50,
            level: 2,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-16T09:00:00.000Z',
          },
        ],
        user: {
          PK: 'user#test',
          SK: 'USER#profile',
          id: 'local_user',
          totalXp: 30,
          level: 1,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-16T09:00:00.000Z',
        },
      })
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})

      const { statusCode } = parseResponse(
        await handler(makeEvent('PUT /completions/{id}', { body: { undoneAt: '2026-04-16T10:00:00.000Z' }, pathParameters: { id: 'c1' } }))
      )

      expect(statusCode).toBe(200)
      expect(getPutItems()).toEqual(expect.arrayContaining([
        expect.objectContaining({ SK: 'USER#profile', totalXp: 20, level: 1 }),
        expect.objectContaining({ SK: 'SKILL#s1', totalXp: 40, level: 1 }),
      ]))
    })

    it('moves skill XP when resolvedSkillId changes to another skill', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'user#test',
          SK: 'COMPLETION#c1',
          id: 'c1',
          questId: 'q1',
          userXpAwarded: 10,
          resolvedSkillId: 's1',
          skillXpAwarded: 10,
          createdAt: '2026-04-16T09:00:00.000Z',
        },
      })
      mockAggregateLoad({
        completions: [
          {
            id: 'c0',
            questId: 'q0',
            userXpAwarded: 20,
            resolvedSkillId: 's1',
            skillXpAwarded: 40,
            createdAt: '2026-04-16T08:00:00.000Z',
          },
          {
            id: 'c1',
            questId: 'q1',
            userXpAwarded: 10,
            resolvedSkillId: 's1',
            skillXpAwarded: 10,
            createdAt: '2026-04-16T09:00:00.000Z',
          },
          {
            id: 'c2',
            questId: 'q2',
            userXpAwarded: 20,
            resolvedSkillId: 's2',
            skillXpAwarded: 40,
            createdAt: '2026-04-16T07:00:00.000Z',
          },
        ],
        skills: [
          {
            PK: 'user#test',
            SK: 'SKILL#s1',
            id: 's1',
            name: 'Reading',
            totalXp: 50,
            level: 2,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-16T09:00:00.000Z',
          },
          {
            PK: 'user#test',
            SK: 'SKILL#s2',
            id: 's2',
            name: 'Health',
            totalXp: 40,
            level: 1,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-16T07:00:00.000Z',
          },
        ],
        user: {
          PK: 'user#test',
          SK: 'USER#profile',
          id: 'local_user',
          totalXp: 50,
          level: 1,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-16T09:00:00.000Z',
        },
      })
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})

      const { statusCode } = parseResponse(
        await handler(makeEvent('PUT /completions/{id}', { body: { resolvedSkillId: 's2' }, pathParameters: { id: 'c1' } }))
      )

      expect(statusCode).toBe(200)
      expect(getPutItems()).toEqual(expect.arrayContaining([
        expect.objectContaining({ SK: 'SKILL#s1', totalXp: 40, level: 1 }),
        expect.objectContaining({ SK: 'SKILL#s2', totalXp: 50, level: 2 }),
      ]))
    })
  })

  it('returns 400 for unknown route', async () => {
    const result = await handler(makeEvent('PATCH /completions'))
    expect(result.statusCode).toBe(400)
  })
})
