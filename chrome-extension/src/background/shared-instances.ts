import { TimeAccumulator } from './time-accumulator'
import { SyncQueue } from '@ext/lib/sync-queue'
import { createApiClient } from '@ext/lib/api-client'

export const timeAccumulator = new TimeAccumulator()
export const syncQueue = new SyncQueue()
export const apiClient = createApiClient()
