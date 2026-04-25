import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoRefreshToken,
} from 'amazon-cognito-identity-js'
import { toJstIsoString } from '@ext/lib/jst-time'

const USER_POOL_ID = 'ap-northeast-1_sdcbFbWBY'
const CLIENT_ID = '4vcj0n0b0b55354k29frt2q6ku'

const userPool = new CognitoUserPool({
  UserPoolId: USER_POOL_ID,
  ClientId: CLIENT_ID,
})

interface AuthState {
  idToken: string
  accessToken?: string
  refreshToken?: string
  email: string
  loggedInAt: string
}

type LoginResult =
  | { ok: true }
  | { ok: false; error: 'INVALID_CREDENTIALS' | 'NEW_PASSWORD_REQUIRED' | 'UNKNOWN' }

export function login(email: string, password: string): Promise<LoginResult> {
  const authDetails = new AuthenticationDetails({
    Username: email,
    Password: password,
  })

  const cognitoUser = new CognitoUser({
    Username: email,
    Pool: userPool,
  })

  return new Promise((resolve) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: async (session) => {
        const idToken = session.getIdToken().getJwtToken()
        const authState: AuthState = {
          idToken,
          accessToken: session.getAccessToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken(),
          email,
          loggedInAt: toJstIsoString(),
        }
        await chrome.storage.local.set({ authState })
        resolve({ ok: true })
      },
      onFailure: (err) => {
        if (err.code === 'NotAuthorizedException' || err.code === 'UserNotFoundException') {
          resolve({ ok: false, error: 'INVALID_CREDENTIALS' })
        } else {
          resolve({ ok: false, error: 'UNKNOWN' })
        }
      },
      newPasswordRequired: () => {
        resolve({ ok: false, error: 'NEW_PASSWORD_REQUIRED' })
      },
    })
  })
}

export async function logout(): Promise<void> {
  const currentUser = userPool.getCurrentUser()
  if (currentUser) {
    currentUser.signOut()
  }
  await chrome.storage.local.remove('authState')
}

export async function getStoredToken(): Promise<string | null> {
  const result = await chrome.storage.local.get('authState')
  const authState = result.authState as AuthState | undefined
  if (!authState?.idToken) return null

  // Check JWT expiration
  try {
    const payload = JSON.parse(atob(authState.idToken.split('.')[1]))
    const expiresAt = payload.exp * 1000
    if (Date.now() < expiresAt) {
      return authState.idToken
    }
  } catch {
    return null
  }

  // Token expired — attempt Cognito session refresh
  return refreshToken()
}

async function refreshToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get('authState')
  const authState = stored.authState as AuthState | undefined

  // Extension service workers cannot rely on Cognito's localStorage-backed cache.
  if (authState?.refreshToken) {
    const token = await refreshWithStoredRefreshToken(authState)
    if (token) {
      return token
    }
  }

  return refreshFromCurrentUser(authState)
}

async function refreshWithStoredRefreshToken(authState: AuthState): Promise<string | null> {
  return new Promise((resolve) => {
    const cognitoUser = new CognitoUser({
      Username: authState.email,
      Pool: userPool,
    })
    const refreshToken = new CognitoRefreshToken({
      RefreshToken: authState.refreshToken!,
    })

    cognitoUser.refreshSession(refreshToken, async (err: Error | null, session: {
      isValid?: () => boolean
      getIdToken: () => { getJwtToken: () => string }
      getAccessToken?: () => { getJwtToken: () => string }
      getRefreshToken?: () => { getToken: () => string }
    } | null) => {
      if (err || !session || (typeof session.isValid === 'function' && !session.isValid())) {
        resolve(null)
        return
      }

      const nextState: AuthState = {
        ...authState,
        idToken: session.getIdToken().getJwtToken(),
        accessToken: session.getAccessToken?.().getJwtToken() ?? authState.accessToken,
        refreshToken: session.getRefreshToken?.().getToken() ?? authState.refreshToken,
        loggedInAt: toJstIsoString(),
      }
      await chrome.storage.local.set({ authState: nextState })
      resolve(nextState.idToken)
    })
  })
}

async function refreshFromCurrentUser(authState?: AuthState): Promise<string | null> {
  return new Promise((resolve) => {
    const currentUser = userPool.getCurrentUser()
    if (!currentUser) {
      resolve(null)
      return
    }

    currentUser.getSession(async (err: Error | null, session: {
      isValid: () => boolean
      getIdToken: () => { getJwtToken: () => string }
      getAccessToken?: () => { getJwtToken: () => string }
      getRefreshToken?: () => { getToken: () => string }
    } | null) => {
      if (err || !session?.isValid()) {
        resolve(null)
        return
      }

      const nextState: AuthState = {
        ...authState,
        idToken: session.getIdToken().getJwtToken(),
        accessToken: session.getAccessToken?.().getJwtToken() ?? authState?.accessToken,
        refreshToken: session.getRefreshToken?.().getToken() ?? authState?.refreshToken,
        email: authState?.email ?? '',
        loggedInAt: toJstIsoString(),
      }
      await chrome.storage.local.set({ authState: nextState })
      resolve(nextState.idToken)
    })
  })
}

export async function isLoggedIn(): Promise<boolean> {
  const token = await getStoredToken()
  return token !== null
}
