import { describe, it, expect, beforeEach } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../userConfigHandler/index.mjs'

describe('userConfigHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  const routes = [
    { path: '/user', sk: 'USER#profile' },
    { path: '/settings', sk: 'SETTINGS#main' },
    { path: '/ai-config', sk: 'AICONFIG#main' },
    { path: '/meta', sk: 'META#main' },
  ]

  for (const { path, sk } of routes) {
    describe(`GET ${path}`, () => {
      it('returns item without PK/SK', async () => {
        mockSend.mockResolvedValueOnce({
          Item: { PK: 'user#test', SK: sk, name: 'Test' },
        })

        const { statusCode, body } = parseResponse(
          await handler(makeEvent(`GET ${path}`))
        )
        expect(statusCode).toBe(200)
        expect(body).toEqual({ name: 'Test' })
      })

      it('returns null when no item', async () => {
        mockSend.mockResolvedValueOnce({ Item: undefined })

        const { statusCode, body } = parseResponse(
          await handler(makeEvent(`GET ${path}`))
        )
        expect(statusCode).toBe(200)
        expect(body).toBeNull()
      })
    })

    describe(`PUT ${path}`, () => {
      it('saves item and returns success', async () => {
        mockSend.mockResolvedValueOnce({})

        const data = { name: 'Updated' }
        const { statusCode, body } = parseResponse(
          await handler(makeEvent(`PUT ${path}`, { body: data }))
        )
        expect(statusCode).toBe(200)
        expect(body.updated).toBe(true)
      })
    })
  }

  it('returns 400 for unknown route', async () => {
    const result = await handler(makeEvent('GET /unknown'))
    expect(result.statusCode).toBe(400)
  })
})
