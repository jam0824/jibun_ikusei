import { TimeAccumulator } from './time-accumulator'
import { SyncQueue } from '@ext/lib/sync-queue'
import { ClassificationCache } from '@ext/lib/classification-cache'
import { createApiClient } from '@ext/lib/api-client'

export const timeAccumulator = new TimeAccumulator()
export const syncQueue = new SyncQueue()
export const classificationCache = new ClassificationCache()
export const apiClient = createApiClient()
