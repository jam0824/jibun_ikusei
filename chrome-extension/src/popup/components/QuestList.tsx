import type { DomainTimeEntry } from '@ext/types/browsing'

interface Props {
  domainTimes: Record<string, DomainTimeEntry>
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}時間${m}分`
  return `${m}分`
}

export function QuestList({ domainTimes }: Props) {
  const entries = Object.values(domainTimes)
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 10)

  if (entries.length === 0) {
    return <div style={{ fontSize: 13, color: '#999' }}>まだ閲覧データがありません</div>
  }

  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <tbody>
        {entries.map((e) => (
          <tr key={e.cacheKey} style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '4px 0' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  marginRight: 6,
                  backgroundColor: e.isGrowth ? '#00897b' : e.isBlocklisted ? '#e53935' : '#f57c00',
                }}
              />
              {e.domain}
            </td>
            <td style={{ textAlign: 'right', padding: '4px 0', color: '#666' }}>
              {formatTime(e.totalSeconds)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
