import { useEffect, useState } from 'react'
import { login, logout, getStoredToken, isLoggedIn } from '@ext/lib/auth'

interface Props {
  serverBaseUrl: string
  authToken?: string
  onSave: (serverBaseUrl: string, authToken: string) => void
}

export function AuthSettings({ serverBaseUrl, onSave }: Props) {
  const [url, setUrl] = useState(serverBaseUrl)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [loggedInEmail, setLoggedInEmail] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checkLoginState()
  }, [])

  const checkLoginState = async () => {
    const token = await getStoredToken()
    if (token) {
      setLoggedIn(true)
      const result = await chrome.storage.local.get('authState')
      if (result.authState?.email) {
        setLoggedInEmail(result.authState.email)
      }
    }
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
      if (result.ok) {
        setLoggedIn(true)
        setLoggedInEmail(email)
        setPassword('')
        // Save server URL and update auth token
        const token = await getStoredToken()
        if (token) {
          onSave(url.trim(), token)
        }
      } else {
        switch (result.error) {
          case 'INVALID_CREDENTIALS':
            setError('メールアドレスまたはパスワードが正しくありません')
            break
          case 'NEW_PASSWORD_REQUIRED':
            setError('パスワードの変更が必要です。Webアプリからログインしてパスワードを変更してください')
            break
          default:
            setError('ログインに失敗しました')
        }
      }
    } catch {
      setError('ログインに失敗しました')
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    setLoggedIn(false)
    setLoggedInEmail('')
    setEmail('')
    setError(null)
  }

  const handleSaveUrl = () => {
    onSave(url.trim(), '')
  }

  return (
    <div>
      <h3>サーバー接続設定</h3>

      <div style={{ marginBottom: 12 }}>
        <label>サーバーURL:</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ width: '100%', padding: 6, marginTop: 4 }}
          placeholder="https://api.example.com"
        />
        <button onClick={handleSaveUrl} style={{ marginTop: 4, padding: '4px 12px' }}>
          URL保存
        </button>
      </div>

      <h3>ログイン</h3>

      {loggedIn ? (
        <div>
          <p style={{ color: 'green', marginBottom: 8 }}>
            ログイン中: {loggedInEmail}
          </p>
          <button onClick={handleLogout} style={{ padding: '6px 16px' }}>
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
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: 6, marginTop: 4 }}
              placeholder="user@example.com"
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>パスワード:</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: 6, marginTop: 4 }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>

          <button onClick={handleLogin} disabled={loggingIn} style={{ padding: '6px 16px' }}>
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
