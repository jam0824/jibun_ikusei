import { useState } from 'react'
import type { CognitoUser } from 'amazon-cognito-identity-js'
import { login, setNewPassword } from '@/lib/auth'

interface Props {
  onLogin: () => void
}

export function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword_] = useState('')
  const [phase, setPhase] = useState<'login' | 'new_password'>('login')
  const [cognitoUser, setCognitoUser] = useState<CognitoUser | undefined>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(undefined)

    const result = await login(email, password)
    setLoading(false)

    if (result.ok) {
      onLogin()
    } else if (result.error === 'NEW_PASSWORD_REQUIRED') {
      setCognitoUser(result.cognitoUser)
      setPhase('new_password')
    } else {
      setError('メールアドレスまたはパスワードが正しくありません。')
    }
  }

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cognitoUser) return
    setLoading(true)
    setError(undefined)

    const result = await setNewPassword(cognitoUser, newPassword)
    setLoading(false)

    if (result.ok) {
      onLogin()
    } else {
      setError('パスワードの設定に失敗しました。もう一度お試しください。')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚔️</div>
          <h1 className="text-2xl font-bold text-white">自分育成</h1>
          <p className="text-violet-300 text-sm mt-1">あなたの冒険が待っています</p>
        </div>

        <div className="bg-slate-800/60 rounded-2xl p-6 border border-slate-700">
          {phase === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">メールアドレス</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm border border-slate-600 focus:outline-none focus:border-violet-500"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">パスワード</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm border border-slate-600 focus:outline-none focus:border-violet-500"
                  placeholder="••••••••"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
              >
                {loading ? 'ログイン中...' : 'ログイン'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleNewPassword} className="space-y-4">
              <p className="text-slate-300 text-sm">初回ログインのため、新しいパスワードを設定してください。</p>
              <div>
                <label className="block text-sm text-slate-300 mb-1">新しいパスワード</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword_(e.target.value)}
                  required
                  minLength={8}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm border border-slate-600 focus:outline-none focus:border-violet-500"
                  placeholder="8文字以上"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
              >
                {loading ? '設定中...' : 'パスワードを設定'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
