import { useEffect, useState } from 'react'
import type { DailyProgress as DailyProgressType, WeeklyReport as WeeklyReportType } from '@ext/types/browsing'
import { DailyProgress } from './components/DailyProgress'
import { QuestList } from './components/QuestList'
import { WeeklyReport } from './components/WeeklyReport'

function getTodayString(): string {
  return new Date().toISOString().split('T')[0]
}

export function App() {
  const [progress, setProgress] = useState<DailyProgressType | null>(null)
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportType | null>(null)

  useEffect(() => {
    // Initial load with date check
    chrome.storage.local.get(['dailyProgress', 'weeklyReport']).then((result) => {
      const data = result.dailyProgress as DailyProgressType | undefined
      if (data && data.date === getTodayString()) {
        setProgress(data)
      }
      const report = result.weeklyReport as WeeklyReportType | undefined
      if (report && Date.now() - new Date(report.generatedAt).getTime() < 14 * 24 * 60 * 60 * 1000) {
        setWeeklyReport(report)
      }
    })

    // Listen for storage changes
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.dailyProgress?.newValue) {
        const data = changes.dailyProgress.newValue as DailyProgressType
        if (data.date === getTodayString()) {
          setProgress(data)
        }
      }
      if (changes.weeklyReport?.newValue) {
        setWeeklyReport(changes.weeklyReport.newValue as WeeklyReportType)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
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

      {weeklyReport && (
        <>
          <h3 style={{ margin: '16px 0 8px', fontSize: 13 }}>週間レポート</h3>
          <WeeklyReport report={weeklyReport} />
        </>
      )}
    </div>
  )
}
