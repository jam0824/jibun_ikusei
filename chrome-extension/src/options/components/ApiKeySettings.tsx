import { useState } from 'react'
import type { AiProvider, ExtensionSettings } from '@ext/types/settings'

interface Props {
  settings: ExtensionSettings
  onSave: (settings: Partial<ExtensionSettings>) => void
}

export function ApiKeySettings({ settings, onSave }: Props) {
  const [provider, setProvider] = useState<AiProvider>(settings.aiProvider)
  const [openaiKey, setOpenaiKey] = useState(settings.openaiApiKey ?? '')
  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const handleSave = () => {
    onSave({
      aiProvider: provider,
      openaiApiKey: openaiKey || undefined,
      geminiApiKey: geminiKey || undefined,
    })
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const apiKey = provider === 'openai' ? openaiKey : geminiKey
      if (!apiKey) {
        setTestResult('APIキーを入力してください')
        return
      }

      const url =
        provider === 'openai'
          ? 'https://api.openai.com/v1/responses'
          : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (provider === 'openai') {
        headers['Authorization'] = `Bearer ${apiKey}`
      } else {
        headers['x-goog-api-key'] = apiKey
      }

      const body =
        provider === 'openai'
          ? JSON.stringify({
              model: 'gpt-5.4-nano',
              input: [
                {
                  role: 'system',
                  content: [{ type: 'input_text', text: 'Return only valid JSON that strictly matches the provided schema. Reply with {"ok": true}.' }],
                },
                {
                  role: 'user',
                  content: [{ type: 'input_text', text: '{"instruction": "Return {\\"ok\\": true}."}' }],
                },
              ],
              text: {
                format: {
                  type: 'json_schema',
                  name: 'connection_check',
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { ok: { type: 'boolean' } },
                    required: ['ok'],
                  },
                  strict: true,
                },
              },
              max_output_tokens: 50,
            })
          : JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Return {"ok": true}' }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                  required: ['ok'],
                },
              },
            })

      const res = await fetch(url, { method: 'POST', headers, body })
      if (res.ok) {
        setTestResult('接続成功')
      } else {
        const errorText = await res.text().catch(() => '')
        setTestResult(`エラー: ${res.status} ${errorText.slice(0, 100)}`)
      }
    } catch (e) {
      setTestResult(`接続失敗: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <h3>AIプロバイダー設定</h3>
      <div style={{ marginBottom: 12 }}>
        <label>
          <input
            type="radio"
            name="provider"
            value="openai"
            checked={provider === 'openai'}
            onChange={() => setProvider('openai')}
          />
          OpenAI (gpt-5.4-nano)
        </label>
        <label style={{ marginLeft: 16 }}>
          <input
            type="radio"
            name="provider"
            value="gemini"
            checked={provider === 'gemini'}
            onChange={() => setProvider('gemini')}
          />
          Gemini (gemini-2.5-flash)
        </label>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label>OpenAI APIキー:</label>
        <input
          type="password"
          value={openaiKey}
          onChange={(e) => setOpenaiKey(e.target.value)}
          style={{ width: '100%', padding: 6, marginTop: 4 }}
          placeholder="sk-..."
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Gemini APIキー:</label>
        <input
          type="password"
          value={geminiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
          style={{ width: '100%', padding: 6, marginTop: 4 }}
          placeholder="AI..."
        />
      </div>

      <button onClick={handleSave} style={{ marginRight: 8, padding: '6px 16px' }}>
        保存
      </button>
      <button onClick={handleTest} disabled={testing} style={{ padding: '6px 16px' }}>
        {testing ? 'テスト中...' : '接続テスト'}
      </button>

      {testResult && (
        <div style={{ marginTop: 8, color: testResult.includes('成功') ? 'green' : 'red' }}>
          {testResult}
        </div>
      )}
    </div>
  )
}
