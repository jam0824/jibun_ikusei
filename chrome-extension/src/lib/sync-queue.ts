import { getLocal, setLocal } from '@ext/lib/storage'

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

export class SyncQueue {
  async enqueue(req: { path: string; method: string; body: unknown }): Promise<void> {
    const queue = await this.load()
    queue.push({
      ...req,
      enqueuedAt: new Date().toISOString(),
    })
    await this.save(queue)
  }

  async getPending(): Promise<QueuedRequest[]> {
    return this.load()
  }

  async replay(
    executor: (req: { path: string; method: string; body: unknown }) => Promise<void>,
  ): Promise<void> {
    const queue = await this.load()
    const failed: QueuedRequest[] = []

    for (const req of queue) {
      try {
        await executor(req)
      } catch (err) {
        if (err instanceof NonRetryableError) continue
        req.retryCount = (req.retryCount ?? 0) + 1
        if (req.retryCount < MAX_RETRIES) {
          failed.push(req)
        }
      }
    }

    await this.save(failed)
  }

  private async load(): Promise<QueuedRequest[]> {
    return (await getLocal<QueuedRequest[]>(STORAGE_KEY)) ?? []
  }

  private async save(queue: QueuedRequest[]): Promise<void> {
    await setLocal(STORAGE_KEY, queue)
  }
}
