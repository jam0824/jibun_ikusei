import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../fitbitDataHandler/index.mjs'

const SAMPLE_SUMMARY = {
  date: '2026-04-04',
  heart: { resting_heart_rate: 62, heart_zones: [], intraday_points: 1440 },
  active_zone_minutes: { intraday_points: 0, minutes_total_estimate: null, summary_rows: 0 },
  sleep: { main_sleep: { minutes_asleep: 397 }, all_sleep_count: 1 },
  activity: { steps: 8234, distance: 5.91, calories: 2143 },
}

describe('fitbitDataHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  // ----------------------------------------------------------------
  // POST /fitbit-data
  // ----------------------------------------------------------------
  describe('POST /fitbit-data', () => {
    it('サマリーデータをupsertする', async () => {
      let savedItem = null
      mockSend.mockImplementation((command) => {
        savedItem = command.input.Item
        return Promise.resolve({})
      })

      const { statusCode } = parseResponse(
        await handler(makeEvent('POST /fitbit-data', { body: SAMPLE_SUMMARY })),
      )

      expect(statusCode).toBe(200)
      expect(savedItem.PK).toBe('user#test-user-123')
      expect(savedItem.SK).toBe('FITBIT#2026-04-04')
      expect(savedItem.date).toBe('2026-04-04')
      expect(savedItem.activity.steps).toBe(8234)
    })

    it('updatedAt が設定される', async () => {
      let savedItem = null
      mockSend.mockImplementation((command) => {
        savedItem = command.input.Item
        return Promise.resolve({})
      })

      await handler(makeEvent('POST /fitbit-data', { body: SAMPLE_SUMMARY }))

      expect(savedItem.updatedAt).toBeDefined()
    })

    it('date がない場合は 400 を返す', async () => {
      const { statusCode } = parseResponse(
        await handler(makeEvent('POST /fitbit-data', { body: { heart: {} } })),
      )

      expect(statusCode).toBe(400)
    })

    it('body がない場合は 400 を返す', async () => {
      const event = makeEvent('POST /fitbit-data')
      event.body = null
      const { statusCode } = parseResponse(await handler(event))

      expect(statusCode).toBe(400)
    })
  })

  // ----------------------------------------------------------------
  // GET /fitbit-data (期間クエリ)
  // ----------------------------------------------------------------
  describe('GET /fitbit-data (from/to)', () => {
    it('指定期間のFitbitデータを返す', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'user#test-user-123',
            SK: 'FITBIT#2026-04-04',
            date: '2026-04-04',
            activity: { steps: 8234 },
            updatedAt: '2026-04-04T10:00:00.000Z',
          },
        ],
      })

      const event = makeEvent('GET /fitbit-data')
      event.queryStringParameters = { from: '2026-04-02', to: '2026-04-04' }
      const { statusCode, body } = parseResponse(await handler(event))

      expect(statusCode).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0].date).toBe('2026-04-04')
      expect(body[0]).not.toHaveProperty('PK')
      expect(body[0]).not.toHaveProperty('SK')
    })

    it('from/to がない場合は 400 を返す', async () => {
      const event = makeEvent('GET /fitbit-data')
      event.queryStringParameters = {}
      const { statusCode } = parseResponse(await handler(event))

      expect(statusCode).toBe(400)
    })
  })

  // ----------------------------------------------------------------
  // GET /fitbit-data (単一日)
  // ----------------------------------------------------------------
  describe('GET /fitbit-data (date)', () => {
    it('単一日のFitbitデータを返す', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'user#test-user-123',
          SK: 'FITBIT#2026-04-04',
          date: '2026-04-04',
          activity: { steps: 8234 },
        },
      })

      const event = makeEvent('GET /fitbit-data')
      event.queryStringParameters = { date: '2026-04-04' }
      const { statusCode, body } = parseResponse(await handler(event))

      expect(statusCode).toBe(200)
      expect(body.date).toBe('2026-04-04')
      expect(body).not.toHaveProperty('PK')
      expect(body).not.toHaveProperty('SK')
    })

    it('存在しない日付は null を返す', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined })

      const event = makeEvent('GET /fitbit-data')
      event.queryStringParameters = { date: '2026-01-01' }
      const { statusCode, body } = parseResponse(await handler(event))

      expect(statusCode).toBe(200)
      expect(body).toBeNull()
    })
  })
})
