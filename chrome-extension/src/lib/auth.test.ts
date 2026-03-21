import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted so mock fns are available inside the vi.mock factory
const { mockAuthenticateUser, mockGetSession, mockSignOut, mockGetCurrentUser } = vi.hoisted(() => ({
  mockAuthenticateUser: vi.fn(),
  mockGetSession: vi.fn(),
  mockSignOut: vi.fn(),
  mockGetCurrentUser: vi.fn(),
}))

vi.mock('amazon-cognito-identity-js', () => {
  return {
    CognitoUserPool: vi.fn().mockImplementation(() => ({
      getCurrentUser: mockGetCurrentUser,
    })),
    CognitoUser: vi.fn().mockImplementation(() => ({
      authenticateUser: mockAuthenticateUser,
      getSession: mockGetSession,
      signOut: mockSignOut,
    })),
    AuthenticationDetails: vi.fn(),
  }
})

import { login, logout, getStoredToken, isLoggedIn } from '@ext/lib/auth'

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Don't use restoreAllMocks — it strips vi.mock() implementations
  })

  it('stores token in chrome.storage.local on successful login', async () => {
    mockAuthenticateUser.mockImplementation((_details: unknown, callbacks: { onSuccess: (session: unknown) => void }) => {
      callbacks.onSuccess({
        getIdToken: () => ({
          getJwtToken: () => 'test-jwt-token',
        }),
        getAccessToken: () => ({
          getJwtToken: () => 'test-access-token',
        }),
      })
    })

    const result = await login('test@example.com', 'password123')

    expect(result.ok).toBe(true)

    // Verify token was stored in chrome.storage.local
    const stored = await chrome.storage.local.get('authState')
    expect(stored.authState).toBeDefined()
    expect(stored.authState.idToken).toBe('test-jwt-token')
    expect(stored.authState.email).toBe('test@example.com')
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

  it('retrieves stored token from chrome.storage.local', async () => {
    await chrome.storage.local.set({
      authState: {
        idToken: 'stored-jwt',
        email: 'user@example.com',
        loggedInAt: new Date().toISOString(),
      },
    })

    const token = await getStoredToken()
    expect(token).toBe('stored-jwt')
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
    await chrome.storage.local.set({
      authState: {
        idToken: 'valid-token',
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
