import { getLocal, setLocal } from '@ext/lib/storage'
import type { createApiClient } from '@ext/lib/api-client'

interface ActivityLogEntry {
  timestamp: string
  source: 'chrome-extension'
  action: string
  category: string
  details: Record<string, unknown>
}

const STORAGE_KEY = 'activityLogBuffer'

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

export async function logActivity(
  action: string,
  category: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const buffer = (await getLocal<ActivityLogEntry[]>(STORAGE_KEY)) ?? []
  buffer.push({
    timestamp: buildJstTimestamp(),
    source: 'chrome-extension',
    action,
    category,
    details,
  })
  await setLocal(STORAGE_KEY, buffer)
}

export async function logError(
  err: unknown,
  context: string = 'unknown',
): Promise<void> {
  const error = err instanceof Error ? err : new Error(String(err))
  await logActivity('system.error', 'error', {
    name: error.name,
    message: error.message,
    stack: error.stack ?? null,
    context,
  })
}

export async function flushActivityLogs(
  apiClient: ReturnType<typeof createApiClient>,
): Promise<void> {
  const buffer = (await getLocal<ActivityLogEntry[]>(STORAGE_KEY)) ?? []
  if (buffer.length === 0) return

  try {
    await apiClient.postActivityLogs({ entries: buffer })
    await setLocal(STORAGE_KEY, [])
  } catch (err) {
    console.error('[activity-logger] flush failed:', err)
  }
}
