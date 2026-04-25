import type { createApiClient } from '@ext/lib/api-client'
import { toJstIsoString } from '@ext/lib/jst-time'
import { getLocal, mutateLocal } from '@ext/lib/storage'

export interface ActivityLogEntry {
  timestamp: string
  source: 'chrome-extension'
  action: string
  category: string
  details: Record<string, unknown>
}

const STORAGE_KEY = 'activityLogBuffer'

function getActivityIdentity(entry: ActivityLogEntry): string {
  return JSON.stringify([entry.timestamp, entry.action, entry.category, entry.details])
}

export async function logActivity(
  action: string,
  category: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await mutateLocal<ActivityLogEntry[]>(STORAGE_KEY, [], (buffer) => {
    buffer.push({
      timestamp: toJstIsoString(),
      source: 'chrome-extension',
      action,
      category,
      details,
    })
  })
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
  const snapshot = (await getLocal<ActivityLogEntry[]>(STORAGE_KEY)) ?? []
  if (snapshot.length === 0) return

  try {
    await apiClient.postActivityLogs({ entries: snapshot })
    const sentIdentities = new Set(snapshot.map(getActivityIdentity))

    await mutateLocal<ActivityLogEntry[]>(STORAGE_KEY, [], (currentBuffer) => (
      currentBuffer.filter((entry) => !sentIdentities.has(getActivityIdentity(entry)))
    ))
  } catch (err) {
    console.error('[activity-logger] flush failed:', err)
  }
}
