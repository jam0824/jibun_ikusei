import { useEffect, useState } from 'react'
import type { DailyProgress as DailyProgressType } from '@ext/types/browsing'
import { DailyProgress } from './components/DailyProgress'
import { QuestList } from './components/QuestList'

export function App() {
  const [progress, setProgress] = useState<DailyProgressType | null>(null)

  useEffect(() => {
    chrome.storage.local.get('dailyProgress').then((result) => {
      if (result.dailyProgress) {
        setProgress(result.dailyProgress as DailyProgressType)
      }
    })
  }, [])

  return (
    <div style={{ width: 320, padding: 16, fontFamily: 'sans-serif' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>今日の進捗</h2>

      {progress ? (
        <>
          <DailyProgress progress={progress} />
          <h3 style={{ margin: '16px 0 8px', fontSize: 13 }}>ドメイン別</h3>
          <QuestList domainTimes={progress.domainTimes} />
        </>
      ) : (
        <p style={{ color: '#999', fontSize: 13 }}>まだデータがありません</p>
      )}
    </div>
  )
}
