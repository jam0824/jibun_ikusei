import { beforeEach, describe, expect, it } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../chatHandler/index.mjs'

describe('chatHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('POST /chat-sessions', () => {
    it('creates a chat session', async () => {
      mockSend.mockResolvedValue({})

      const body = { id: 'chat_1', title: 'new chat' }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /chat-sessions', { body })),
      )

      expect(statusCode).toBe(201)
      expect(resBody.id).toBe('chat_1')
      expect(resBody.title).toBe('new chat')
      expect(resBody.createdAt).toBeDefined()

      const putCmd = mockSend.mock.calls[0][0]
      expect(putCmd.input.Item.PK).toBe('user#test-user-123')
      expect(putCmd.input.Item.SK).toBe('CHAT_SESSION#chat_1')
    })
  })

  describe('GET /chat-sessions', () => {
    it('lists sessions ordered by updatedAt desc', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { PK: 'user#test-user-123', SK: 'CHAT_SESSION#chat_1', id: 'chat_1', title: 'older', updatedAt: '2026-03-22T10:00:00Z' },
          { PK: 'user#test-user-123', SK: 'CHAT_SESSION#chat_2', id: 'chat_2', title: 'newer', updatedAt: '2026-03-22T11:00:00Z' },
        ],
      })

      const { statusCode, body } = parseResponse(await handler(makeEvent('GET /chat-sessions')))

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(2)
      expect(body[0].id).toBe('chat_2')
      expect(body[0].PK).toBeUndefined()
      expect(body[0].SK).toBeUndefined()
    })
  })

  describe('PUT /chat-sessions/{id}', () => {
    it('updates a session', async () => {
      mockSend.mockResolvedValue({})

      const body = { title: 'renamed' }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('PUT /chat-sessions/{id}', { body, pathParameters: { id: 'chat_1' } })),
      )

      expect(statusCode).toBe(200)
      expect(resBody.id).toBe('chat_1')
      expect(resBody.title).toBe('renamed')
    })
  })

  describe('DELETE /chat-sessions/{id}', () => {
    it('deletes the session and all messages', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [
            { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_1' },
            { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_2' },
          ],
        })
        .mockResolvedValueOnce({})

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('DELETE /chat-sessions/{id}', { pathParameters: { id: 'chat_1' } })),
      )

      expect(statusCode).toBe(200)
      expect(body.deleted).toBe('chat_1')
      expect(mockSend).toHaveBeenCalledTimes(2)

      const batchCmd = mockSend.mock.calls[1][0]
      const deleteRequests = batchCmd.input.RequestItems['test-table']
      expect(deleteRequests).toHaveLength(3)
    })
  })

  describe('POST /chat-sessions/{id}/messages', () => {
    it('stores chat messages with GSI attributes', async () => {
      mockSend.mockResolvedValue({})

      const body = { id: 'cmsg_1', role: 'user', content: 'hello' }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /chat-sessions/{id}/messages', {
          body,
          pathParameters: { id: 'chat_1' },
        })),
      )

      expect(statusCode).toBe(201)
      expect(resBody.sessionId).toBe('chat_1')
      expect(resBody.content).toBe('hello')

      const putCmd = mockSend.mock.calls[0][0]
      expect(putCmd.input.Item.SK).toBe('CHAT_MSG#chat_1#cmsg_1')
      expect(putCmd.input.Item.GSI1PK).toBe('CHAT_MSG#test-user-123')
      expect(typeof putCmd.input.Item.GSI1SK).toBe('number')
    })
  })

  describe('GET /chat-sessions/{id}/messages', () => {
    it('lists messages in a session', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_1', id: 'cmsg_1', role: 'user', content: 'hello', createdAt: '2026-03-22T10:00:00Z' },
          { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_2', id: 'cmsg_2', role: 'assistant', content: 'hi', createdAt: '2026-03-22T10:00:01Z' },
        ],
      })

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('GET /chat-sessions/{id}/messages', {
          pathParameters: { id: 'chat_1' },
        })),
      )

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(2)
      expect(body[0].role).toBe('user')
      expect(body[1].role).toBe('assistant')
      expect(body[0].PK).toBeUndefined()
    })
  })

  describe('GET /chat-messages', () => {
    it('queries the GSI with JST day boundaries', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_1', id: 'cmsg_1', sessionId: 'chat_1', role: 'user', content: 'hello', createdAt: '2026-03-28T15:00:00.000Z', GSI1PK: 'CHAT_MSG#test-user-123', GSI1SK: 1743174000000 },
          { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_2#cmsg_2', id: 'cmsg_2', sessionId: 'chat_2', role: 'assistant', content: 'world', createdAt: '2026-03-29T14:59:59.000Z', GSI1PK: 'CHAT_MSG#test-user-123', GSI1SK: 1743256799000 },
        ],
      })

      const { statusCode, body } = parseResponse(
        await handler(
          makeEvent('GET /chat-messages', {
            queryStringParameters: { from: '2026-03-29', to: '2026-03-29' },
          }),
        ),
      )

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(2)

      const queryCmd = mockSend.mock.calls[0][0]
      expect(queryCmd.input.IndexName).toBe('GSI1')
      expect(queryCmd.input.ExpressionAttributeValues[':gsi1pk']).toBe('CHAT_MSG#test-user-123')
      expect(queryCmd.input.ExpressionAttributeValues[':from']).toBe(1774710000000)
      expect(queryCmd.input.ExpressionAttributeValues[':to']).toBe(1774796399999)
    })
  })

  describe('unknown route', () => {
    it('returns 400', async () => {
      const { statusCode } = parseResponse(await handler(makeEvent('PATCH /unknown')))
      expect(statusCode).toBe(400)
    })
  })
})
