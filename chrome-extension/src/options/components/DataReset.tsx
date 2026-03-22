import { useState } from 'react'

const KEYS_TO_CLEAR = [
  'dailyProgress',
  'dailyProgressHistory',
  'classificationCache',
  'weeklyReport',
]

export function DataReset() {
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)

  const handleReset = async () => {
    await chrome.storage.local.remove(KEYS_TO_CLEAR)
    setConfirming(false)
    setDone(true)
    setTimeout(() => setDone(false), 3000)
  }

  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>データリセット</h2>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
        今日の進捗・閲覧履歴・分類キャッシュ・週間レポートをすべて削除します。設定（APIキー・ブロックリスト）は保持されます。
      </p>

      {done && (
        <div style={{ padding: 8, background: '#e8f5e9', color: '#2e7d32', borderRadius: 4, marginBottom: 8, fontSize: 13 }}>
          リセットが完了しました
        </div>
      )}

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          style={{
            fontSize: 13,
            padding: '6px 16px',
            background: '#ef5350',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          全データをリセット
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#d32f2f' }}>本当にリセットしますか？</span>
          <button
            onClick={handleReset}
            style={{
              fontSize: 13,
              padding: '6px 16px',
              background: '#d32f2f',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            リセット実行
          </button>
          <button
            onClick={() => setConfirming(false)}
            style={{
              fontSize: 13,
              padding: '6px 16px',
              background: '#9e9e9e',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            キャンセル
          </button>
        </div>
      )}
    </div>
  )
}
