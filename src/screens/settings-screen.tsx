import { useMemo, useState } from 'react'
import { Download, Eye, EyeOff, Settings2, Trash2, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { maskApiKey } from '@/domain/logic'
import { Screen } from '@/components/layout'
import { Badge, Button, Card, CardContent, Input, Select, Switch } from '@/components/ui'
import { useAppStore } from '@/store/app-store'

export function SettingsScreen() {
  const navigate = useNavigate()
  const state = useAppStore()
  const [openAiVisible, setOpenAiVisible] = useState(false)
  const [geminiVisible, setGeminiVisible] = useState(false)
  const [importError, setImportError] = useState<string>()

  const providerStatus = useMemo(
    () => ({
      openai: state.aiConfig.providers.openai.status ?? 'unverified',
      gemini: state.aiConfig.providers.gemini.status ?? 'unverified',
    }),
    [state.aiConfig.providers.gemini.status, state.aiConfig.providers.openai.status],
  )

  return (
    <Screen
      title="設定"
      subtitle="AI、音声、通知、データ管理を調整します"
      action={
        <Button size="icon" onClick={() => navigate('/')}>
          <Settings2 className="h-5 w-5" />
        </Button>
      }
    >
      <section className="space-y-3">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">リリィ音声</div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">音声を有効化</div>
                <div className="mt-1 text-xs text-slate-500">AI音声またはブラウザ音声でリリィを再生します。</div>
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
                onChange={(event) => state.setSettings({ lilyAutoPlay: event.target.value as 'on' | 'tap_only' | 'off' })}
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
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">通知</div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">アプリ内リマインド</div>
                <div className="mt-1 text-xs text-slate-500">未クリア時の軽い促しを表示します。</div>
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
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI設定</div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">AI利用</div>
                <div className="mt-1 text-xs text-slate-500">スキル抽象化とリリィ文生成を行います。</div>
              </div>
              <Switch checked={state.settings.aiEnabled} onCheckedChange={(checked) => state.setSettings({ aiEnabled: checked })} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">アクティブプロバイダ</div>
              <Select
                value={state.aiConfig.activeProvider}
                onChange={(event) => state.setActiveProvider(event.target.value as 'openai' | 'gemini' | 'none')}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="none">利用しない</option>
              </Select>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">OpenAI</div>
                  <div className="text-xs text-slate-500">{maskApiKey(state.aiConfig.providers.openai.apiKey)}</div>
                </div>
                <Badge tone={providerStatus.openai === 'verified' ? 'success' : providerStatus.openai === 'invalid' ? 'danger' : 'outline'}>
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
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => void state.testConnection('openai')}>接続テスト</Button>
                <Button variant="secondary" onClick={() => state.setAiConfig('openai', { apiKey: '', status: 'unverified' })}>キー削除</Button>
              </div>
              {state.connectionState.openai.message ? <div className="mt-2 text-xs text-slate-500">{state.connectionState.openai.message}</div> : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Gemini</div>
                  <div className="text-xs text-slate-500">{maskApiKey(state.aiConfig.providers.gemini.apiKey)}</div>
                </div>
                <Badge tone={providerStatus.gemini === 'verified' ? 'success' : providerStatus.gemini === 'invalid' ? 'danger' : 'outline'}>
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
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => void state.testConnection('gemini')}>接続テスト</Button>
                <Button variant="secondary" onClick={() => state.setAiConfig('gemini', { apiKey: '', status: 'unverified' })}>キー削除</Button>
              </div>
              {state.connectionState.gemini.message ? <div className="mt-2 text-xs text-slate-500">{state.connectionState.gemini.message}</div> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">データ管理</div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => state.exportData()}>
                <Download className="h-4 w-4" />
                JSONエクスポート
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
                JSONインポート
              </Button>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">インポート方法</div>
              <Select value={state.importMode} onChange={(event) => state.setImportMode(event.target.value as 'merge' | 'replace')}>
                <option value="merge">統合</option>
                <option value="replace">置換</option>
              </Select>
            </div>
            {importError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{importError}</div> : null}
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
              全ローカルデータ削除
            </Button>
          </CardContent>
        </Card>
      </section>
    </Screen>
  )
}
