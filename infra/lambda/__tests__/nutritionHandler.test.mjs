import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../nutritionHandler/index.mjs'

describe('nutritionHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  // ---------------------------------------------------------------
  // GET /nutrition
  // ---------------------------------------------------------------

  describe('GET /nutrition', () => {
    it('dateパラメータがない場合は400を返す', async () => {
      const event = makeEvent('GET /nutrition')
      event.queryStringParameters = {}
      const { statusCode } = parseResponse(await handler(event))
      expect(statusCode).toBe(400)
    })

    it('指定日の全区分をnullで返す（データなし）', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] })

      const event = makeEvent('GET /nutrition')
      event.queryStringParameters = { date: '2026-04-04' }

      const { statusCode, body } = parseResponse(await handler(event))
      expect(statusCode).toBe(200)
      expect(body.daily).toBeNull()
      expect(body.breakfast).toBeNull()
      expect(body.lunch).toBeNull()
      expect(body.dinner).toBeNull()
    })

    it('登録済み区分のデータを返す（一部あり）', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test-user-123',
            SK: 'NUTRITION#2026-04-04#daily',
            userId: 'test-user-123',
            date: '2026-04-04',
            mealType: 'daily',
            nutrients: { energy: { value: 1822, unit: 'kcal', label: '不足', threshold: null } },
            createdAt: '2026-04-04T00:00:00.000Z',
            updatedAt: '2026-04-04T00:00:00.000Z',
          },
        ],
      })

      const event = makeEvent('GET /nutrition')
      event.queryStringParameters = { date: '2026-04-04' }

      const { statusCode, body } = parseResponse(await handler(event))
      expect(statusCode).toBe(200)
      expect(body.daily).not.toBeNull()
      expect(body.daily.mealType).toBe('daily')
      expect(body.daily.nutrients.energy.value).toBe(1822)
      expect(body.breakfast).toBeNull()
    })

    it('PK/SKフィールドをレスポンスから除外する', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test-user-123',
            SK: 'NUTRITION#2026-04-04#daily',
            date: '2026-04-04',
            mealType: 'daily',
            nutrients: {},
            createdAt: '2026-04-04T00:00:00.000Z',
            updatedAt: '2026-04-04T00:00:00.000Z',
          },
        ],
      })

      const event = makeEvent('GET /nutrition')
      event.queryStringParameters = { date: '2026-04-04' }

      const { body } = parseResponse(await handler(event))
      expect(body.daily.PK).toBeUndefined()
      expect(body.daily.SK).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------
  // PUT /nutrition/{date}/{mealType}
  // ---------------------------------------------------------------

  describe('PUT /nutrition/{date}/{mealType}', () => {
    it('栄養素レコードを保存して200を返す', async () => {
      mockSend.mockResolvedValueOnce({})

      const body = {
        userId: 'test-user-123',
        nutrients: { energy: { value: 1822, unit: 'kcal', label: '不足', threshold: null } },
      }
      const event = makeEvent('PUT /nutrition/{date}/{mealType}', {
        body,
        pathParameters: { date: '2026-04-04', mealType: 'daily' },
      })

      const { statusCode, body: res } = parseResponse(await handler(event))
      expect(statusCode).toBe(200)
      expect(res.date).toBe('2026-04-04')
      expect(res.mealType).toBe('daily')
    })

    it('不正なmealTypeの場合は400を返す', async () => {
      const event = makeEvent('PUT /nutrition/{date}/{mealType}', {
        body: { nutrients: {} },
        pathParameters: { date: '2026-04-04', mealType: 'invalid' },
      })

      const { statusCode } = parseResponse(await handler(event))
      expect(statusCode).toBe(400)
    })

    it('createdAtが未指定の場合は自動設定される', async () => {
      mockSend.mockResolvedValueOnce({})

      const event = makeEvent('PUT /nutrition/{date}/{mealType}', {
        body: { nutrients: {} },
        pathParameters: { date: '2026-04-04', mealType: 'breakfast' },
      })

      const { body } = parseResponse(await handler(event))
      expect(body.createdAt).toBeTruthy()
      expect(body.updatedAt).toBeTruthy()
    })

    it('同一キーで再度保存するとupdatedAtが更新される（上書き）', async () => {
      mockSend.mockResolvedValueOnce({})

      const oldCreatedAt = '2026-04-01T00:00:00.000Z'
      const event = makeEvent('PUT /nutrition/{date}/{mealType}', {
        body: { nutrients: {}, createdAt: oldCreatedAt },
        pathParameters: { date: '2026-04-04', mealType: 'daily' },
      })

      const { body } = parseResponse(await handler(event))
      expect(body.createdAt).toBe(oldCreatedAt)
      expect(body.updatedAt).not.toBe(oldCreatedAt)
    })
  })
})
