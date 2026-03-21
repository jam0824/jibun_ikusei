import type { WeeklyReport as WeeklyReportType } from '@ext/types/browsing'

interface Props {
  report: WeeklyReportType | null
}

export function WeeklyReport({ report }: Props) {
  if (!report) {
    return <div style={{ fontSize: 13, color: '#999' }}>週間レポートはまだありません</div>
  }

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{report.weekKey} 週間レポート</div>
      <div>合計: {report.totalMinutes}分</div>
      <div style={{ color: '#00897b' }}>成長: {report.goodMinutes}分</div>
      <div style={{ color: '#e53935' }}>注意: {report.badMinutes}分</div>
      <div>クエスト達成: {report.goodQuestsCleared}</div>
      <div>バッド: {report.badQuestsTriggered}</div>
      {report.lilyComment && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: '#f3e5f5',
            borderRadius: 6,
            fontStyle: 'italic',
          }}
        >
          Lily: {report.lilyComment}
        </div>
      )}
    </div>
  )
}
