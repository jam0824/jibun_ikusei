import { vi } from 'vitest'

// Mock db.send
export const mockSend = vi.fn()

vi.mock('/opt/nodejs/utils.mjs', () => ({
  db: { send: (...args) => mockSend(...args) },
  TABLE_NAME: 'test-table',
  getUserId: (event) => event.requestContext.authorizer.jwt.claims.sub,
  response: (statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  parseBody: (event) => JSON.parse(event.body),
}))

export function makeEvent(routeKey, { body, pathParameters } = {}) {
  return {
    routeKey,
    body: body ? JSON.stringify(body) : undefined,
    pathParameters: pathParameters ?? {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'test-user-123' } } },
    },
  }
}

export function parseResponse(result) {
  return { statusCode: result.statusCode, body: JSON.parse(result.body) }
}
