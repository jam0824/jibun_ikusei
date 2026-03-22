import { postActivityLogs } from '@/lib/api-client'

interface ActivityLogEntry {
  timestamp: string
  source: 'web'
  action: string
  category: string
  details: Record<string, unknown>
}

const buffer: ActivityLogEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function buildJstTimestamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}+09:00`
}

export function logActivity(
  action: string,
  category: string,
  details: Record<string, unknown> = {},
): void {
  buffer.push({
    timestamp: buildJstTimestamp(),
    source: 'web',
    action,
    category,
    details,
  })

  if (!flushTimer) {
    flushTimer = setTimeout(flush, 30_000)
  }
}

export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }

  if (buffer.length === 0) return

  const entries = buffer.splice(0)
  try {
    await postActivityLogs(entries)
  } catch {
    buffer.unshift(...entries)
  }
}

/** @internal Test helper to access the buffer */
export function _getBuffer(): ActivityLogEntry[] {
  return buffer
}

/** @internal Test helper to reset internal state */
export function _reset(): void {
  buffer.length = 0
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
