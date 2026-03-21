import { useEffect, useState } from 'react'
import type { ExtensionSettings } from '@ext/types/settings'
import { createDefaultSettings } from '@ext/types/settings'
import { ApiKeySettings } from './components/ApiKeySettings'
import { BlocklistEditor } from './components/BlocklistEditor'
import { ClassificationManager } from './components/ClassificationManager'
import { AuthSettings } from './components/AuthSettings'

export function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local.get('extensionSettings').then((result) => {
      if (result.extensionSettings) {
        setSettings({ ...createDefaultSettings(), ...result.extensionSettings } as ExtensionSettings)
      } else {
        setSettings(createDefaultSettings())
      }
    })
  }, [])

  const saveSettings = (updated: Partial<ExtensionSettings>) => {
    const newSettings = { ...settings!, ...updated }
    setSettings(newSettings as ExtensionSettings)
    chrome.storage.local.set({ extensionSettings: newSettings })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!settings) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
        <p>読み込み中...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 24 }}>自分育成 - 拡張設定</h1>

      {saved && (
        <div style={{ padding: 8, background: '#e8f5e9', color: '#2e7d32', borderRadius: 4, marginBottom: 16 }}>
          設定を保存しました
        </div>
      )}

      <ApiKeySettings settings={settings} onSave={saveSettings} />

      <hr style={{ margin: '24px 0' }} />

      <BlocklistEditor
        blocklist={settings.blocklist}
        onSave={(blocklist) => saveSettings({ blocklist })}
      />

      <hr style={{ margin: '24px 0' }} />

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>分類の手動補正</h2>
      <ClassificationManager />

      <hr style={{ margin: '24px 0' }} />

      <AuthSettings
        serverBaseUrl={settings.serverBaseUrl}
        authToken={settings.authToken}
        onSave={(serverBaseUrl, authToken) => saveSettings({ serverBaseUrl, authToken })}
      />
    </div>
  )
}
