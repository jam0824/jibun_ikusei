import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../browsingTimeHandler/index.mjs'

describe('browsingTimeHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe('GET /browsing-times', () => {
    it('日付範囲でブラウジングデータを返す', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test', SK: 'BROWSE#2026-03-20',
            date: '2026-03-20',
            domains: { 'github.com': { totalSeconds: 3600, category: '仕事', isGrowth: true } },
            totalSeconds: 3600,
          },
          {
            PK: 'user#test', SK: 'BROWSE#2026-03-21',
            date: '2026-03-21',
            domains: { 'youtube.com': { totalSeconds: 1800, category: '娯楽', isGrowth: false } },
            totalSeconds: 1800,
          },
        ],
      })

      const event = makeEvent('GET /browsing-times')
      event.queryStringParameters = { from: '2026-03-20', to: '2026-03-21' }
      const { statusCode, body } = parseResponse(await handler(event))

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(2)
      expect(body[0].date).toBe('2026-03-20')
      expect(body[0]).not.toHaveProperty('PK')
      expect(body[0]).not.toHaveProperty('SK')
    })

    it('データがない場合は空配列を返す', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] })

      const event = makeEvent('GET /browsing-times')
      event.queryStringParameters = { from: '2026-03-20', to: '2026-03-21' }
      const { statusCode, body } = parseResponse(await handler(event))

      expect(statusCode).toBe(200)
      expect(body).toEqual([])
    })

    it('fromとtoが未指定の場合は400を返す', async () => {
      const event = makeEvent('GET /browsing-times')
      event.queryStringParameters = {}
      const { statusCode } = parseResponse(await handler(event))
      expect(statusCode).toBe(400)
    })
  })

  describe('POST /browsing-times', () => {
    it('日次ドメイン時間データを保存する', async () => {
      mockSend.mockResolvedValue({})

      const body = {
        entries: [{
          date: '2026-03-22',
          domains: { 'github.com': { totalSeconds: 3600, category: '仕事', isGrowth: true } },
          totalSeconds: 3600,
        }],
      }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /browsing-times', { body }))
      )

      expect(statusCode).toBe(200)
      expect(resBody.synced).toBe(1)
    })

    it('複数日分のデータを一括保存する', async () => {
      mockSend.mockResolvedValue({})

      const body = {
        entries: [
          { date: '2026-03-20', domains: {}, totalSeconds: 0 },
          { date: '2026-03-21', domains: {}, totalSeconds: 0 },
          { date: '2026-03-22', domains: {}, totalSeconds: 0 },
        ],
      }
      const { statusCode, body: resBody } = parseResponse(
        await handler(makeEvent('POST /browsing-times', { body }))
      )

      expect(statusCode).toBe(200)
      expect(resBody.synced).toBe(3)
      expect(mockSend).toHaveBeenCalledTimes(3)
    })
  })

  it('不明なルートで400を返す', async () => {
    const result = await handler(makeEvent('PATCH /browsing-times'))
    expect(result.statusCode).toBe(400)
  })
})
