import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../chatHandler/index.mjs'

describe('chatHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('POST /chat-sessions', () => {
    it('セッションを作成できる', async () => {
      mockSend.mockResolvedValue({})

      const body = { id: 'chat_1', title: '新しい会話' }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /chat-sessions', { body }))
      )

      expect(statusCode).toBe(201)
      expect(resBody.id).toBe('chat_1')
      expect(resBody.title).toBe('新しい会話')
      expect(resBody.createdAt).toBeDefined()
      expect(mockSend).toHaveBeenCalledTimes(1)

      const putCmd = mockSend.mock.calls[0][0]
      expect(putCmd.input.Item.PK).toBe('user#test-user-123')
      expect(putCmd.input.Item.SK).toBe('CHAT_SESSION#chat_1')
    })
  })

  describe('GET /chat-sessions', () => {
    it('全セッションを取得できる', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { PK: 'user#test-user-123', SK: 'CHAT_SESSION#chat_1', id: 'chat_1', title: '会話1', updatedAt: '2026-03-22T10:00:00Z' },
          { PK: 'user#test-user-123', SK: 'CHAT_SESSION#chat_2', id: 'chat_2', title: '会話2', updatedAt: '2026-03-22T11:00:00Z' },
        ],
      })

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('GET /chat-sessions'))
      )

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(2)
      // Should be sorted by updatedAt desc
      expect(body[0].id).toBe('chat_2')
      expect(body[0].PK).toBeUndefined()
      expect(body[0].SK).toBeUndefined()
    })
  })

  describe('PUT /chat-sessions/{id}', () => {
    it('セッションを更新できる', async () => {
      mockSend.mockResolvedValue({})

      const body = { title: '更新されたタイトル' }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('PUT /chat-sessions/{id}', { body, pathParameters: { id: 'chat_1' } }))
      )

      expect(statusCode).toBe(200)
      expect(resBody.id).toBe('chat_1')
      expect(resBody.title).toBe('更新されたタイトル')
    })
  })

  describe('DELETE /chat-sessions/{id}', () => {
    it('セッションと全メッセージを削除できる', async () => {
      // First call: query messages
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_1' },
          { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_2' },
        ],
      })
      // Second call: batch delete
      mockSend.mockResolvedValueOnce({})

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('DELETE /chat-sessions/{id}', { pathParameters: { id: 'chat_1' } }))
      )

      expect(statusCode).toBe(200)
      expect(body.deleted).toBe('chat_1')
      expect(mockSend).toHaveBeenCalledTimes(2)

      // Verify batch delete includes session + 2 messages = 3 items
      const batchCmd = mockSend.mock.calls[1][0]
      const deleteRequests = batchCmd.input.RequestItems['test-table']
      expect(deleteRequests).toHaveLength(3)
    })
  })

  describe('POST /chat-sessions/{id}/messages', () => {
    it('メッセージを追加できる', async () => {
      mockSend.mockResolvedValue({})

      const body = { id: 'cmsg_1', role: 'user', content: 'こんにちは' }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /chat-sessions/{id}/messages', {
          body,
          pathParameters: { id: 'chat_1' },
        }))
      )

      expect(statusCode).toBe(201)
      expect(resBody.sessionId).toBe('chat_1')
      expect(resBody.content).toBe('こんにちは')

      const putCmd = mockSend.mock.calls[0][0]
      expect(putCmd.input.Item.SK).toBe('CHAT_MSG#chat_1#cmsg_1')
    })
  })

  describe('GET /chat-sessions/{id}/messages', () => {
    it('セッションのメッセージを取得できる', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_1', id: 'cmsg_1', role: 'user', content: 'こんにちは', createdAt: '2026-03-22T10:00:00Z' },
          { PK: 'user#test-user-123', SK: 'CHAT_MSG#chat_1#cmsg_2', id: 'cmsg_2', role: 'assistant', content: '元気ですか？', createdAt: '2026-03-22T10:00:01Z' },
        ],
      })

      const { statusCode, body } = parseResponse(
        await handler(makeEvent('GET /chat-sessions/{id}/messages', {
          pathParameters: { id: 'chat_1' },
        }))
      )

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(2)
      expect(body[0].role).toBe('user')
      expect(body[1].role).toBe('assistant')
      expect(body[0].PK).toBeUndefined()
    })
  })

  describe('不明なルート', () => {
    it('400を返す', async () => {
      const { statusCode } = parseResponse(
        await handler(makeEvent('PATCH /unknown'))
      )
      expect(statusCode).toBe(400)
    })
  })
})
