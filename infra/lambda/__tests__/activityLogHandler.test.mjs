import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../activityLogHandler/index.mjs'

describe('activityLogHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('POST /activity-logs', () => {
    it('ログエントリをバルク保存する', async () => {
      mockSend.mockResolvedValue({})

      const body = {
        entries: [
          { timestamp: '2026-03-22T14:30:00.000+09:00', source: 'web', action: 'quest.complete', category: 'quest', details: { questId: 'q1' } },
          { timestamp: '2026-03-22T14:31:00.000+09:00', source: 'web', action: 'xp.gain', category: 'xp', details: { xp: 10 } },
        ],
      }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /activity-logs', { body }))
      )

      expect(statusCode).toBe(200)
      expect(resBody.logged).toBe(2)
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    it('entriesが空の場合400を返す', async () => {
      const { statusCode } = parseResponse(
        await handler(makeEvent('POST /activity-logs', { body: { entries: [] } }))
      )
      expect(statusCode).toBe(400)
    })

    it('entriesが未指定の場合400を返す', async () => {
      const { statusCode } = parseResponse(
        await handler(makeEvent('POST /activity-logs', { body: {} }))
      )
      expect(statusCode).toBe(400)
    })

    it('100件を超える場合400を返す', async () => {
      const entries = Array.from({ length: 101 }, (_, i) => ({
        timestamp: `2026-03-22T14:${String(i).padStart(2, '0')}:00.000+09:00`,
        source: 'web', action: 'test', category: 'test', details: {},
      }))
      const { statusCode } = parseResponse(
        await handler(makeEvent('POST /activity-logs', { body: { entries } }))
      )
      expect(statusCode).toBe(400)
    })

    it('各アイテムにttl属性が設定される', async () => {
      let savedItem = null
      mockSend.mockImplementation((cmd) => {
        savedItem = cmd.input.Item
        return Promise.resolve({})
      })

      const body = {
        entries: [
          { timestamp: '2026-03-22T14:30:00.000+09:00', source: 'web', action: 'test', category: 'test', details: {} },
        ],
      }
      await handler(makeEvent('POST /activity-logs', { body }))

      expect(savedItem).toBeDefined()
      expect(savedItem.ttl).toBeTypeOf('number')
      // TTL should be roughly 31 days from now (within a minute tolerance)
      const expectedTtl = Math.floor(Date.now() / 1000) + 31 * 86400
      expect(savedItem.ttl).toBeGreaterThan(expectedTtl - 60)
      expect(savedItem.ttl).toBeLessThan(expectedTtl + 60)
    })

    it('SKがLOG#timestamp#uuid形式で保存される', async () => {
      let savedItem = null
      mockSend.mockImplementation((cmd) => {
        savedItem = cmd.input.Item
        return Promise.resolve({})
      })

      const body = {
        entries: [
          { timestamp: '2026-03-22T14:30:00.000+09:00', source: 'web', action: 'test', category: 'test', details: {} },
        ],
      }
      await handler(makeEvent('POST /activity-logs', { body }))

      expect(savedItem.SK).toMatch(/^LOG#2026-03-22T14:30:00\.000\+09:00#[a-f0-9]{8}$/)
    })
  })

  describe('GET /activity-logs', () => {
    it('日付範囲でログを返す', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'user#test', SK: 'LOG#2026-03-22T14:30:00.000+09:00#abc12345', ttl: 9999, source: 'web', action: 'quest.complete', category: 'quest', details: {}, timestamp: '2026-03-22T14:30:00.000+09:00' },
        ],
      })

      const event = makeEvent('GET /activity-logs')
      event.queryStringParameters = { from: '2026-03-22', to: '2026-03-22' }
      const { statusCode, body } = parseResponse(await handler(event))

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0].action).toBe('quest.complete')
      expect(body[0]).not.toHaveProperty('PK')
      expect(body[0]).not.toHaveProperty('SK')
      expect(body[0]).not.toHaveProperty('ttl')
    })

    it('from/toが未指定の場合400を返す', async () => {
      const event = makeEvent('GET /activity-logs')
      event.queryStringParameters = {}
      const { statusCode } = parseResponse(await handler(event))
      expect(statusCode).toBe(400)
    })

    it('データがない場合は空配列を返す', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] })

      const event = makeEvent('GET /activity-logs')
      event.queryStringParameters = { from: '2026-03-22', to: '2026-03-22' }
      const { statusCode, body } = parseResponse(await handler(event))

      expect(statusCode).toBe(200)
      expect(body).toEqual([])
    })
  })

  it('不明なルートで400を返す', async () => {
    const result = await handler(makeEvent('PATCH /activity-logs'))
    expect(result.statusCode).toBe(400)
  })
})
