interface ProgressBarProps {
  goodSeconds: number
  otherSeconds: number
  badSeconds: number
}

export function ProgressBar({ goodSeconds, otherSeconds, badSeconds }: ProgressBarProps) {
  const total = goodSeconds + otherSeconds + badSeconds
  const goodPct = total > 0 ? Math.round((goodSeconds / total) * 100) : 0
  const otherPct = total > 0 ? Math.round((otherSeconds / total) * 100) : 0
  const badPct = total > 0 ? Math.round((badSeconds / total) * 100) : 0

  return (
    <div
      style={{
        display: 'flex',
        height: 12,
        borderRadius: 6,
        overflow: 'hidden',
        background: '#e0e0e0',
      }}
    >
      <div
        data-testid="bar-good"
        style={{
          width: `${goodPct}%`,
          backgroundColor: 'rgb(0, 137, 123)',
          transition: 'width 0.3s',
        }}
      />
      <div
        data-testid="bar-other"
        style={{
          width: `${otherPct}%`,
          backgroundColor: 'rgb(245, 124, 0)',
          transition: 'width 0.3s',
        }}
      />
      <div
        data-testid="bar-bad"
        style={{
          width: `${badPct}%`,
          backgroundColor: 'rgb(229, 57, 53)',
          transition: 'width 0.3s',
        }}
      />
    </div>
  )
}
