import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateUser,
  mockRefreshSession,
  mockGetSession,
  mockSignOut,
  mockGetCurrentUser,
} = vi.hoisted(() => ({
  mockAuthenticateUser: vi.fn(),
  mockRefreshSession: vi.fn(),
  mockGetSession: vi.fn(),
  mockSignOut: vi.fn(),
  mockGetCurrentUser: vi.fn(),
}))

vi.mock('amazon-cognito-identity-js', () => {
  return {
    CognitoUserPool: vi.fn().mockImplementation(() => ({
      getCurrentUser: mockGetCurrentUser,
    })),
    CognitoUser: vi.fn().mockImplementation((data: { Username: string }) => ({
      authenticateUser: mockAuthenticateUser,
      refreshSession: mockRefreshSession,
      getSession: mockGetSession,
      signOut: mockSignOut,
      getUsername: () => data.Username,
    })),
    AuthenticationDetails: vi.fn(),
    CognitoRefreshToken: vi.fn().mockImplementation(({ RefreshToken }: { RefreshToken: string }) => ({
      getToken: () => RefreshToken,
    })),
  }
})

import { login, logout, getStoredToken, isLoggedIn } from '@ext/lib/auth'

function createMockJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.fake-signature`
}

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    // keep module mocks intact
  })

  it('stores tokens in chrome.storage.local on successful login', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-21T03:04:05.006Z'))

    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onSuccess: (session: unknown) => void }) => {
      callbacks.onSuccess({
        getIdToken: () => ({
          getJwtToken: () => 'test-jwt-token',
        }),
        getAccessToken: () => ({
          getJwtToken: () => 'test-access-token',
        }),
        getRefreshToken: () => ({
          getToken: () => 'test-refresh-token',
        }),
      })
    })

    const result = await login('test@example.com', 'password123')

    expect(result.ok).toBe(true)

    const stored = await chrome.storage.local.get('authState')
    expect(stored.authState).toBeDefined()
    expect(stored.authState.idToken).toBe('test-jwt-token')
    expect(stored.authState.accessToken).toBe('test-access-token')
    expect(stored.authState.refreshToken).toBe('test-refresh-token')
    expect(stored.authState.email).toBe('test@example.com')
    expect(stored.authState.loggedInAt).toBe('2026-03-21T12:04:05.006+09:00')
  })

  it('returns error on invalid credentials', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onFailure: (err: { code: string }) => void }) => {
      callbacks.onFailure({ code: 'NotAuthorizedException' })
    })

    const result = await login('test@example.com', 'wrong-password')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('INVALID_CREDENTIALS')
    }
  })

  it('returns NEW_PASSWORD_REQUIRED when Cognito requires password change', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { newPasswordRequired: () => void }) => {
      callbacks.newPasswordRequired()
    })

    const result = await login('test@example.com', 'temp-password')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('NEW_PASSWORD_REQUIRED')
    }
  })

  it('returns the stored token while it is still valid', async () => {
    const validToken = createMockJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    await chrome.storage.local.set({
      authState: {
        idToken: validToken,
        email: 'user@example.com',
        loggedInAt: new Date().toISOString(),
      },
    })

    const token = await getStoredToken()
    expect(token).toBe(validToken)
  })

  it('refreshes an expired token with the refresh token stored in chrome.storage.local', async () => {
    const expiredToken = createMockJwt({ exp: Math.floor(Date.now() / 1000) - 60 })
    const refreshedToken = createMockJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    await chrome.storage.local.set({
      authState: {
        idToken: expiredToken,
        accessToken: 'expired-access-token',
        refreshToken: 'stored-refresh-token',
        email: 'user@example.com',
        loggedInAt: new Date().toISOString(),
      },
    })

    mockRefreshSession.mockImplementation((_refreshToken: unknown, cb: (err: null, session: unknown) => void) => {
      cb(null, {
        isValid: () => true,
        getIdToken: () => ({ getJwtToken: () => refreshedToken }),
        getAccessToken: () => ({ getJwtToken: () => 'refreshed-access-token' }),
        getRefreshToken: () => ({ getToken: () => 'stored-refresh-token' }),
      })
    })
    mockGetCurrentUser.mockReturnValue(null)

    const token = await getStoredToken()
    expect(token).toBe(refreshedToken)
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)

    const stored = await chrome.storage.local.get('authState')
    expect(stored.authState.idToken).toBe(refreshedToken)
    expect(stored.authState.accessToken).toBe('refreshed-access-token')
    expect(stored.authState.refreshToken).toBe('stored-refresh-token')
  })

  it('falls back to the Cognito cached session when no refresh token is stored', async () => {
    const expiredToken = createMockJwt({ exp: Math.floor(Date.now() / 1000) - 60 })
    const refreshedToken = createMockJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    await chrome.storage.local.set({
      authState: {
        idToken: expiredToken,
        email: 'user@example.com',
        loggedInAt: new Date().toISOString(),
      },
    })

    mockGetCurrentUser.mockReturnValue({
      getSession: (cb: (err: null, session: unknown) => void) => {
        cb(null, {
          isValid: () => true,
          getIdToken: () => ({ getJwtToken: () => refreshedToken }),
          getAccessToken: () => ({ getJwtToken: () => 'refreshed-access-token' }),
          getRefreshToken: () => ({ getToken: () => 'fallback-refresh-token' }),
        })
      },
    })

    const token = await getStoredToken()
    expect(token).toBe(refreshedToken)

    const stored = await chrome.storage.local.get('authState')
    expect(stored.authState.idToken).toBe(refreshedToken)
    expect(stored.authState.refreshToken).toBe('fallback-refresh-token')
  })

  it('returns null when token refresh fails', async () => {
    const expiredToken = createMockJwt({ exp: Math.floor(Date.now() / 1000) - 60 })
    await chrome.storage.local.set({
      authState: {
        idToken: expiredToken,
        accessToken: 'expired-access-token',
        refreshToken: 'stored-refresh-token',
        email: 'user@example.com',
        loggedInAt: new Date().toISOString(),
      },
    })

    mockRefreshSession.mockImplementation((_refreshToken: unknown, cb: (err: Error | null, session: null) => void) => {
      cb(new Error('refresh failed'), null)
    })
    mockGetCurrentUser.mockReturnValue(null)

    const token = await getStoredToken()
    expect(token).toBeNull()
  })

  it('returns null when no token is stored', async () => {
    const token = await getStoredToken()
    expect(token).toBeNull()
  })

  it('clears auth state on logout', async () => {
    await chrome.storage.local.set({
      authState: {
        idToken: 'some-token',
        email: 'user@example.com',
        loggedInAt: new Date().toISOString(),
      },
    })

    mockGetCurrentUser.mockReturnValue({ signOut: mockSignOut })

    await logout()

    const stored = await chrome.storage.local.get('authState')
    expect(stored.authState).toBeUndefined()
  })

  it('isLoggedIn returns true when token exists', async () => {
    const validToken = createMockJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    await chrome.storage.local.set({
      authState: {
        idToken: validToken,
        email: 'user@example.com',
        loggedInAt: new Date().toISOString(),
      },
    })

    expect(await isLoggedIn()).toBe(true)
  })

  it('isLoggedIn returns false when no token', async () => {
    expect(await isLoggedIn()).toBe(false)
  })
})
