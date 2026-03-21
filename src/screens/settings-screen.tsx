import { useMemo, useState } from 'react'
import { Download, Eye, EyeOff, LogOut, Settings2, Trash2, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { GEMINI_VOICES } from '@/domain/constants'
import { maskApiKey } from '@/domain/logic'
import { usePwaInstall } from '@/lib/pwa'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Input, Select, Switch } from '@/components/ui'
import { logout } from '@/lib/auth'
import { useAppStore } from '@/store/app-store'

export function SettingsScreen() {
  const navigate = useNavigate()
  const state = useAppStore()
  const { canInstall, isInstalled, isOnline, needsIosInstallHelp, promptInstall } = usePwaInstall()
  const [openAiVisible, setOpenAiVisible] = useState(false)
  const [geminiVisible, setGeminiVisible] = useState(false)
  const [importError, setImportError] = useState<string>()
  const [installMessage, setInstallMessage] = useState<string>()

  const providerStatus = useMemo(
    () => ({
      openai: state.aiConfig.providers.openai.status ?? 'unverified',
      gemini: state.aiConfig.providers.gemini.status ?? 'unverified',
    }),
    [state.aiConfig.providers.gemini.status, state.aiConfig.providers.openai.status],
  )

  const installBadgeTone = isInstalled ? 'success' : canInstall || needsIosInstallHelp ? 'outline' : 'soft'

  const handleInstall = async () => {
    const result = await promptInstall()

    if (result.outcome === 'accepted') {
      setInstallMessage('ホーム画面への追加を受け付けました。インストール後はアプリ一覧から開けます。')
      return
    }

    if (result.outcome === 'dismissed') {
      setInstallMessage('インストールはキャンセルされました。必要になったらいつでも追加できます。')
      return
    }

    setInstallMessage('このブラウザではインストール案内を表示できません。')
  }

  return (
    <Screen
      title="設定"
      subtitle="AI、音声、通知、データ管理を調整できます"
      action={
        <Button size="icon" onClick={() => navigate('/')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <section className="space-y-3">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">App</div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">ホーム画面に追加</div>
                <div className="mt-1 text-xs text-slate-500">
                  GitHub Pages 上でもアプリとして起動しやすくなります。
                </div>
              </div>
              <Badge tone={installBadgeTone}>
                {isInstalled ? 'installed' : canInstall || needsIosInstallHelp ? 'available' : 'browser'}
              </Badge>
            </div>

            {canInstall ? (
              <Button onClick={() => void handleInstall()}>ホーム画面に追加</Button>
            ) : null}

            {isInstalled ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                この端末にはインストール済みです。ホーム画面やアプリ一覧から直接開けます。
              </div>
            ) : null}

            {needsIosInstallHelp ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                iPhone / iPad では Safari の共有メニューから「ホーム画面に追加」を選ぶとインストールできます。
              </div>
            ) : null}

            {installMessage ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
                {installMessage}
              </div>
            ) : null}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">オフライン対応</div>
                  <div className="mt-1 text-xs text-slate-500">
                    一度アプリを開いたあとは、主要画面をオフラインでも再訪できます。
                  </div>
                </div>
                <Badge tone={isOnline ? 'success' : 'danger'}>{isOnline ? 'online' : 'offline'}</Badge>
              </div>
              <div className="mt-3 space-y-2 text-xs">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
                  オフラインで使える: クエスト管理、スキル一覧、記録、設定、JSON Import / Export
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                  オンライン必須: AI 接続テスト、Lily メッセージ生成、音声再生
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lily Voice</div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">音声を有効化</div>
                <div className="mt-1 text-xs text-slate-500">
                  Gemini TTS を使って再生します。オフライン中は音声再生を利用できません。
                </div>
              </div>
              <Switch
                checked={state.settings.lilyVoiceEnabled}
                onCheckedChange={(checked) => state.setSettings({ lilyVoiceEnabled: checked })}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">自動再生</div>
              <Select
                value={state.settings.lilyAutoPlay}
                onChange={(event) =>
                  state.setSettings({ lilyAutoPlay: event.target.value as 'on' | 'tap_only' | 'off' })
                }
              >
                <option value="on">ON</option>
                <option value="tap_only">タップ時のみ</option>
                <option value="off">OFF</option>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notifications</div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">通知を有効化</div>
                <div className="mt-1 text-xs text-slate-500">未完了のときにリマインド通知を表示します。</div>
              </div>
              <Switch
                checked={state.settings.notificationsEnabled}
                onCheckedChange={(checked) => state.setSettings({ notificationsEnabled: checked })}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">通知時刻</div>
              <Input
                type="time"
                value={state.settings.reminderTime ?? ''}
                onChange={(event) => state.setSettings({ reminderTime: event.target.value || undefined })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI</div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">AI利用</div>
                <div className="mt-1 text-xs text-slate-500">スキル判定と Lily メッセージ生成に使います。</div>
              </div>
              <Switch
                checked={state.settings.aiEnabled}
                onCheckedChange={(checked) => state.setSettings({ aiEnabled: checked })}
              />
            </div>

            {!isOnline ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                現在オフラインです。AI 接続テスト、Lily メッセージ生成、音声再生を停止しています。
              </div>
            ) : null}

            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">アクティブプロバイダ</div>
              <Select
                value={state.aiConfig.activeProvider}
                onChange={(event) => state.setActiveProvider(event.target.value as 'openai' | 'gemini' | 'none')}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="none">使用しない</option>
              </Select>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">OpenAI</div>
                  <div className="text-xs text-slate-500">{maskApiKey(state.aiConfig.providers.openai.apiKey)}</div>
                </div>
                <Badge
                  tone={
                    providerStatus.openai === 'verified'
                      ? 'success'
                      : providerStatus.openai === 'invalid'
                        ? 'danger'
                        : 'outline'
                  }
                >
                  {providerStatus.openai}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Input
                  type={openAiVisible ? 'text' : 'password'}
                  value={state.aiConfig.providers.openai.apiKey ?? ''}
                  placeholder="OpenAI API Key"
                  onChange={(event) => state.setAiConfig('openai', { apiKey: event.target.value })}
                />
                <Button variant="outline" size="icon" onClick={() => setOpenAiVisible((current) => !current)}>
                  {openAiVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <div className="mt-3">
                <div className="mb-2 text-sm font-semibold text-slate-900">Text model</div>
                <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {state.aiConfig.providers.openai.model}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={!isOnline} onClick={() => void state.testConnection('openai')}>
                  接続テスト
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => state.setAiConfig('openai', { apiKey: '', status: 'unverified' })}
                >
                  キーを消去
                </Button>
              </div>
              {state.connectionState.openai.message ? (
                <div className="mt-2 text-xs text-slate-500">{state.connectionState.openai.message}</div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Gemini</div>
                  <div className="text-xs text-slate-500">{maskApiKey(state.aiConfig.providers.gemini.apiKey)}</div>
                </div>
                <Badge
                  tone={
                    providerStatus.gemini === 'verified'
                      ? 'success'
                      : providerStatus.gemini === 'invalid'
                        ? 'danger'
                        : 'outline'
                  }
                >
                  {providerStatus.gemini}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Input
                  type={geminiVisible ? 'text' : 'password'}
                  value={state.aiConfig.providers.gemini.apiKey ?? ''}
                  placeholder="Gemini API Key"
                  onChange={(event) => state.setAiConfig('gemini', { apiKey: event.target.value })}
                />
                <Button variant="outline" size="icon" onClick={() => setGeminiVisible((current) => !current)}>
                  {geminiVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <div className="mt-3 grid gap-3">
                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-900">Text model</div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    {state.aiConfig.providers.gemini.model}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-900">TTS model</div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    {state.aiConfig.providers.gemini.ttsModel}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-900">Speaker</div>
                  <Select
                    value={state.aiConfig.providers.gemini.voice ?? 'Zephyr'}
                    onChange={(event) => state.setAiConfig('gemini', { voice: event.target.value })}
                  >
                    {GEMINI_VOICES.map((voice) => (
                      <option key={voice} value={voice}>
                        {voice}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={!isOnline} onClick={() => void state.testConnection('gemini')}>
                  接続テスト
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => state.setAiConfig('gemini', { apiKey: '', status: 'unverified' })}
                >
                  キーを消去
                </Button>
              </div>
              {state.connectionState.gemini.message ? (
                <div className="mt-2 text-xs text-slate-500">{state.connectionState.gemini.message}</div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data</div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => state.exportData()}>
                <Download className="h-4 w-4" />
                JSON Export
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = 'application/json'
                  input.onchange = async () => {
                    const file = input.files?.[0]
                    if (!file) {
                      return
                    }
                    const text = await file.text()
                    const result = state.importData(text, state.importMode)
                    if (!result.ok) {
                      setImportError(result.reason)
                    } else {
                      setImportError(undefined)
                    }
                  }
                  input.click()
                }}
              >
                <Upload className="h-4 w-4" />
                JSON Import
              </Button>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">Import mode</div>
              <Select
                value={state.importMode}
                onChange={(event) => state.setImportMode(event.target.value as 'merge' | 'replace')}
              >
                <option value="merge">統合</option>
                <option value="replace">置換</option>
              </Select>
            </div>
            {importError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {importError}
              </div>
            ) : null}
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm('ローカルデータをすべて削除しますか？')) {
                  state.resetLocalData()
                  navigate('/')
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              ローカルデータ削除
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-4">Account</div>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm('ログアウトしますか？')) {
                  logout()
                  window.location.reload()
                }
              }}
            >
              <LogOut className="h-4 w-4" />
              ログアウト
            </Button>
          </CardContent>
        </Card>
      </section>
    </Screen>
  )
}
