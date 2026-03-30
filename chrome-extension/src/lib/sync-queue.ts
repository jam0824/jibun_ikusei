import { getLocal, mutateLocal } from '@ext/lib/storage'

const STORAGE_KEY = 'syncQueue'
const MAX_RETRIES = 10

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

export interface QueuedRequest {
  path: string
  method: string
  body: unknown
  enqueuedAt: string
  retryCount?: number
}

function getRequestIdentity(request: QueuedRequest): string {
  return JSON.stringify([request.path, request.method, request.enqueuedAt, request.body])
}

export class SyncQueue {
  async enqueue(req: { path: string; method: string; body: unknown }): Promise<void> {
    await mutateLocal<QueuedRequest[]>(STORAGE_KEY, [], (queue) => {
      queue.push({
        ...req,
        enqueuedAt: new Date().toISOString(),
      })
    })
  }

  async getPending(): Promise<QueuedRequest[]> {
    return this.load()
  }

  async replay(
    executor: (req: { path: string; method: string; body: unknown }) => Promise<void>,
  ): Promise<void> {
    const snapshot = await this.load()
    if (snapshot.length === 0) return

    const failedByIdentity = new Map<string, QueuedRequest>()

    for (const req of snapshot) {
      try {
        await executor(req)
      } catch (err) {
        if (err instanceof NonRetryableError) continue

        const retryCount = (req.retryCount ?? 0) + 1
        if (retryCount < MAX_RETRIES) {
          failedByIdentity.set(getRequestIdentity(req), {
            ...req,
            retryCount,
          })
        }
      }
    }

    await mutateLocal<QueuedRequest[]>(STORAGE_KEY, [], (currentQueue) => {
      const remainingQueue = [...currentQueue]

      for (const processed of snapshot) {
        const identity = getRequestIdentity(processed)
        const index = remainingQueue.findIndex((candidate) => getRequestIdentity(candidate) === identity)
        if (index === -1) continue

        const failed = failedByIdentity.get(identity)
        if (failed) {
          remainingQueue[index] = failed
        } else {
          remainingQueue.splice(index, 1)
        }
      }

      return remainingQueue
    })
  }

  private async load(): Promise<QueuedRequest[]> {
    return (await getLocal<QueuedRequest[]>(STORAGE_KEY)) ?? []
  }
}
