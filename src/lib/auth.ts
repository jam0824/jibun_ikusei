import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'

const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string,
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string,
})

export type AuthError =
  | 'INVALID_CREDENTIALS'
  | 'NEW_PASSWORD_REQUIRED'
  | 'UNKNOWN'

export type LoginResult =
  | { ok: true }
  | { ok: false; error: AuthError; cognitoUser?: CognitoUser }

export function getCurrentSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser()
    if (!user) return resolve(null)
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) return resolve(null)
      resolve(session)
    })
  })
}

export function getIdToken(): Promise<string | null> {
  return getCurrentSession().then((session) =>
    session ? session.getIdToken().getJwtToken() : null,
  )
}

export function login(email: string, password: string): Promise<LoginResult> {
  return new Promise((resolve) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool })
    const authDetails = new AuthenticationDetails({ Username: email, Password: password })

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: () => resolve({ ok: true }),
      onFailure: (err) => {
        const error = err.code === 'NotAuthorizedException' ? 'INVALID_CREDENTIALS' : 'UNKNOWN'
        resolve({ ok: false, error })
      },
      newPasswordRequired: () => {
        resolve({ ok: false, error: 'NEW_PASSWORD_REQUIRED', cognitoUser })
      },
    })
  })
}

export function setNewPassword(cognitoUser: CognitoUser, newPassword: string): Promise<LoginResult> {
  return new Promise((resolve) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: () => resolve({ ok: true }),
      onFailure: () => resolve({ ok: false, error: 'UNKNOWN' }),
    })
  })
}

export function logout(): void {
  userPool.getCurrentUser()?.signOut()
}

export function isLoggedIn(): Promise<boolean> {
  return getCurrentSession().then((session) => session !== null)
}
