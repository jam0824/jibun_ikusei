import { beforeEach, describe, expect, it } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../situationLogHandler/index.mjs'

describe('situationLogHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  it('POST /situation-logs saves a situation log without ttl', async () => {
    let savedItem = null
    mockSend.mockImplementation((command) => {
      savedItem = command.input.Item
      return Promise.resolve({})
    })

    const { statusCode, body } = parseResponse(
      await handler(
        makeEvent('POST /situation-logs', {
          body: {
            summary: '直近30分は実装と確認を静かに行き来していた。',
            timestamp: '2026-04-17T18:30:00+09:00',
            details: {
              active_apps: ['Code', 'Chrome'],
            },
          },
        }),
      ),
    )

    expect(statusCode).toBe(200)
    expect(body).toEqual({ logged: true })
    expect(savedItem.SK).toContain('SITUATION#2026-04-17T18:30:00+09:00#')
    expect(savedItem).not.toHaveProperty('ttl')
  })

  it('GET /situation-logs strips ttl from returned items', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'user#test-user-123',
          SK: 'SITUATION#2026-04-17T18:30:00+09:00#log_1',
          ttl: 1780000000,
          summary: '直近30分は実装と確認を静かに行き来していた。',
          timestamp: '2026-04-17T18:30:00+09:00',
          details: {
            active_apps: ['Code', 'Chrome'],
          },
        },
      ],
    })

    const event = makeEvent('GET /situation-logs')
    event.queryStringParameters = { from: '2026-04-17', to: '2026-04-17' }
    const { statusCode, body } = parseResponse(await handler(event))

    expect(statusCode).toBe(200)
    expect(body).toEqual([
      {
        summary: '直近30分は実装と確認を静かに行き来していた。',
        timestamp: '2026-04-17T18:30:00+09:00',
        details: {
          active_apps: ['Code', 'Chrome'],
        },
      },
    ])
  })
})
