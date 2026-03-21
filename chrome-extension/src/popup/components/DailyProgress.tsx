import type { DailyProgress as DailyProgressType } from '@ext/types/browsing'
import { BROWSING_XP } from '@ext/types/browsing'
import { ProgressBar } from './ProgressBar'

interface Props {
  progress: DailyProgressType
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}時間${m}分`
  return `${m}分`
}

function getTimeToNextReward(progress: DailyProgressType): number {
  const { goodBrowsingSeconds, lastGoodRewardAtSeconds } = progress
  const nextThreshold =
    lastGoodRewardAtSeconds === 0
      ? BROWSING_XP.FIRST_GOOD_THRESHOLD_SECONDS
      : lastGoodRewardAtSeconds + BROWSING_XP.GOOD_INTERVAL_SECONDS
  return Math.max(0, nextThreshold - goodBrowsingSeconds)
}

export function DailyProgress({ progress }: Props) {
  const remainingSeconds = getTimeToNextReward(progress)

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <StatCard label="成長" value={formatTime(progress.goodBrowsingSeconds)} color="#00897b" bg="#e0f2f1" />
        <StatCard label="その他" value={formatTime(progress.otherBrowsingSeconds)} color="#f57c00" bg="#fff3e0" />
        <StatCard label="注意" value={formatTime(progress.badBrowsingSeconds)} color="#e53935" bg="#ffebee" />
      </div>

      <ProgressBar
        goodSeconds={progress.goodBrowsingSeconds}
        otherSeconds={progress.otherBrowsingSeconds}
        badSeconds={progress.badBrowsingSeconds}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
        <div>
          クエスト達成: <strong>{progress.goodQuestsCleared}</strong>
        </div>
        <div>
          バッド: <strong>{progress.badQuestsTriggered}</strong>
        </div>
      </div>

      {remainingSeconds > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
          次の+2XPまで: {formatTime(remainingSeconds)}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 8, background: bg, borderRadius: 6 }}>
      <div style={{ fontSize: 18, fontWeight: 'bold', color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#666' }}>{label}</div>
    </div>
  )
}
