import React, { useEffect, useState } from 'react'
import { getStoredToken, login, logout } from '@ext/lib/auth'

type ConnectionStatus =
  | { type: 'ok' }
  | { type: 'unauthorized' }
  | { type: 'error'; message: string }
  | { type: 'no_url' }

interface Props {
  serverBaseUrl: string
  authToken?: string
  syncEnabled: boolean
  onSave: (serverBaseUrl: string, authToken: string) => void | Promise<void>
}

function connectionStatusMessage(status: ConnectionStatus): string {
  switch (status.type) {
    case 'ok':
      return '接続 OK: サーバーと正常に通信できています。'
    case 'unauthorized':
      return 'サーバーには到達できましたが、ログイン情報が有効ではありません。'
    case 'error':
      return `サーバーに接続できません (${status.message})`
    case 'no_url':
      return 'サーバー URL を入力してください'
  }
}

function connectionStatusStyle(status: ConnectionStatus): React.CSSProperties {
  switch (status.type) {
    case 'ok':
      return { color: '#2e7d32' }
    case 'unauthorized':
      return { color: '#e65100' }
    case 'error':
    case 'no_url':
      return { color: '#c62828' }
  }
}

async function clearSyncState(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'CLEAR_SYNC_STATE' })
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Failed to clear sync state.')
  }
}

export function AuthSettings({ serverBaseUrl, syncEnabled, onSave }: Props) {
  const [url, setUrl] = useState(serverBaseUrl)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [loggedInEmail, setLoggedInEmail] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null)

  useEffect(() => {
    void checkLoginState()
  }, [])

  useEffect(() => {
    setUrl(serverBaseUrl)
  }, [serverBaseUrl])

  const checkLoginState = async () => {
    const token = await getStoredToken()
    if (!token) return

    setLoggedIn(true)
    const result = await chrome.storage.local.get('authState')
    if (result.authState?.email) {
      setLoggedInEmail(result.authState.email)
    }
  }

  const saveUrlIfChanged = async (nextUrl: string, authToken: string) => {
    if (nextUrl !== serverBaseUrl.trim()) {
      await clearSyncState()
    }
    await onSave(nextUrl, authToken)
  }

  const handleLogin = async () => {
    if (!email || !password) {
      setError('メールアドレスとパスワードを入力してください')
      return
    }

    setLoggingIn(true)
    setError(null)

    try {
      const result = await login(email, password)
      if (!result.ok) {
        switch (result.error) {
          case 'INVALID_CREDENTIALS':
            setError('メールアドレスまたはパスワードが正しくありません')
            break
          case 'NEW_PASSWORD_REQUIRED':
            setError('パスワードの再設定が必要です。Web アプリからログインして変更してください')
            break
          default:
            setError('ログインに失敗しました')
            break
        }
        return
      }

      setLoggedIn(true)
      setLoggedInEmail(email)
      setPassword('')

      const token = await getStoredToken()
      if (token) {
        await saveUrlIfChanged(url.trim(), token)
      }
    } catch {
      setError('ログインに失敗しました')
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
      await clearSyncState()
      await onSave(url.trim(), '')
      setLoggedIn(false)
      setLoggedInEmail('')
      setEmail('')
      setPassword('')
      setError(null)
    } catch {
      setError('ログアウト処理に失敗しました')
    }
  }

  const handleSaveUrl = async () => {
    try {
      setError(null)
      await saveUrlIfChanged(url.trim(), '')
    } catch {
      setError('サーバー設定の保存に失敗しました')
    }
  }

  const handleCheckConnection = async () => {
    if (!url.trim()) {
      setConnectionStatus({ type: 'no_url' })
      return
    }

    setChecking(true)
    setConnectionStatus(null)

    try {
      const token = await getStoredToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }

      const response = await fetch(`${url.trim()}/user`, { headers })
      if (response.ok) {
        setConnectionStatus({ type: 'ok' })
      } else if (response.status === 401) {
        setConnectionStatus({ type: 'unauthorized' })
      } else {
        setConnectionStatus({ type: 'error', message: `HTTP ${response.status}` })
      }
    } catch {
      setConnectionStatus({ type: 'error', message: 'ネットワークエラー' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div>
      <h3>サーバー設定</h3>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: syncEnabled ? '#4caf50' : '#9e9e9e',
          }}
        />
        <span style={{ fontSize: 13, color: syncEnabled ? '#2e7d32' : '#757575' }}>
          同期: {syncEnabled ? 'ON' : 'OFF'}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>サーバー URL:</label>
        <input
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          style={{ width: '100%', padding: 6, marginTop: 4 }}
          placeholder="https://api.example.com"
        />
        <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
          <button onClick={() => void handleSaveUrl()} style={{ padding: '4px 12px' }}>
            URL 保存
          </button>
          <button
            onClick={() => void handleCheckConnection()}
            disabled={checking}
            style={{ padding: '4px 12px' }}
          >
            {checking ? '接続確認中...' : '接続確認'}
          </button>
        </div>
        {connectionStatus && (
          <div style={{ marginTop: 6, fontSize: 13, ...connectionStatusStyle(connectionStatus) }}>
            {connectionStatusMessage(connectionStatus)}
          </div>
        )}
      </div>

      <h3>ログイン</h3>

      {loggedIn ? (
        <div>
          <p style={{ color: 'green', marginBottom: 8 }}>ログイン中: {loggedInEmail}</p>
          <button onClick={() => void handleLogout()} style={{ padding: '6px 16px' }}>
            ログアウト
          </button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 8 }}>
            <label>メールアドレス:</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={{ width: '100%', padding: 6, marginTop: 4 }}
              placeholder="user@example.com"
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>パスワード:</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{ width: '100%', padding: 6, marginTop: 4 }}
              onKeyDown={(event) => event.key === 'Enter' && void handleLogin()}
            />
          </div>

          <button onClick={() => void handleLogin()} disabled={loggingIn} style={{ padding: '6px 16px' }}>
            {loggingIn ? 'ログイン中...' : 'ログイン'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, color: 'red' }}>
          {error}
        </div>
      )}
    </div>
  )
}
