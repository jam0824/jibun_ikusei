import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../healthDataHandler/index.mjs'

describe('healthDataHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('GET /health-data', () => {
    it('指定期間の体重データを返す', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test',
            SK: 'HEALTH#2026-03-20#07:10',
            date: '2026-03-20',
            time: '07:10',
            weight_kg: 65.4,
            body_fat_pct: 18.1,
            source: 'health_planet',
          },
        ],
      })

      const event = makeEvent('GET /health-data')
      event.queryStringParameters = { from: '2026-03-20', to: '2026-03-21' }
      const { statusCode, body } = parseResponse(await handler(event))

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0].weight_kg).toBe(65.4)
      expect(body[0]).not.toHaveProperty('PK')
      expect(body[0]).not.toHaveProperty('SK')
    })

    it('from/to がない場合は 400 を返す', async () => {
      const event = makeEvent('GET /health-data')
      event.queryStringParameters = {}
      const { statusCode } = parseResponse(await handler(event))

      expect(statusCode).toBe(400)
    })
  })

  describe('POST /health-data', () => {
    it('体重データを保存する', async () => {
      let savedItem = null
      mockSend.mockImplementation((command) => {
        savedItem = command.input.Item
        return Promise.resolve({})
      })

      const body = {
        entries: [
          {
            date: '2026-03-20',
            time: '07:10',
            weight_kg: 65.4,
            body_fat_pct: 18.1,
          },
        ],
      }
      const { statusCode, body: responseBody } = parseResponse(
        await handler(makeEvent('POST /health-data', { body })),
      )

      expect(statusCode).toBe(200)
      expect(responseBody.synced).toBe(1)
      expect(savedItem.SK).toBe('HEALTH#2026-03-20#07:10')
      expect(savedItem.source).toBe('health_planet')
    })

    it('entries が空なら 400 を返す', async () => {
      const { statusCode } = parseResponse(
        await handler(makeEvent('POST /health-data', { body: { entries: [] } })),
      )

      expect(statusCode).toBe(400)
    })
  })
})
