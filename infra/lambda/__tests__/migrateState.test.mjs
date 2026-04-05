import { beforeEach, describe, expect, it } from 'vitest'
import { mockSend } from './helpers.mjs'
import { handler } from '../migrateState/index.mjs'

describe('migrateState', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  it('backfills chat message index attributes with pagination', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test-user-123',
            SK: 'CHAT_MSG#chat_1#cmsg_1',
            id: 'cmsg_1',
            sessionId: 'chat_1',
            role: 'user',
            content: 'hello',
            createdAt: '2026-03-28T15:00:00.000Z',
          },
        ],
        LastEvaluatedKey: {
          PK: 'user#test-user-123',
          SK: 'CHAT_MSG#chat_1#cmsg_1',
        },
      })
      .mockResolvedValueOnce({})

    const result = await handler({
      mode: 'chat-message-index-backfill',
      limit: 25,
    })

    const body = JSON.parse(result.body)
    expect(result.statusCode).toBe(200)
    expect(body.updated).toBe(1)
    expect(body.lastEvaluatedKey).toEqual({
      PK: 'user#test-user-123',
      SK: 'CHAT_MSG#chat_1#cmsg_1',
    })

    const putCmd = mockSend.mock.calls[1][0]
    expect(putCmd.input.Item.GSI1PK).toBe('CHAT_MSG#test-user-123')
    expect(putCmd.input.Item.GSI1SK).toBe(1774710000000)
  })
})
