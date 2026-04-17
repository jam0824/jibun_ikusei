import { addDays } from 'date-fns'
import { z } from 'zod'

import type {
  ActivitySession,
  Device,
  ManualNote,
  OpenLoop,
  PrivacyRule,
  RawEvent,
  WeeklyActivityReview,
  DailyActivityLog,
} from '@/domain/action-log-types'
import {
  ACTION_LOG_SOURCES,
  ACTIVITY_CATEGORIES,
  DEVICE_CAPTURE_STATES,
  DEVICE_PLATFORMS,
  OPEN_LOOP_STATUSES,
  PRIVACY_RULE_MODES,
  PRIVACY_RULE_TYPES,
  RAW_EVENT_TYPES,
} from '@/domain/action-log-types'
import { getDayKey, getWeekKey } from '@/lib/date'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const JST_RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?\+09:00$/

export const RAW_EVENT_TTL_DAYS = 30

const jstRfc3339Schema = z.string().regex(JST_RFC3339_PATTERN)
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const weekKeySchema = z.string().regex(/^\d{4}-W\d{2}$/)

const actionLogSourceSchema = z.enum(ACTION_LOG_SOURCES)
const rawEventTypeSchema = z.enum(RAW_EVENT_TYPES)
const activityCategorySchema = z.enum(ACTIVITY_CATEGORIES)
const devicePlatformSchema = z.enum(DEVICE_PLATFORMS)
const deviceCaptureStateSchema = z.enum(DEVICE_CAPTURE_STATES)
const openLoopStatusSchema = z.enum(OPEN_LOOP_STATUSES)
const privacyRuleTypeSchema = z.enum(PRIVACY_RULE_TYPES)
const privacyRuleModeSchema = z.enum(PRIVACY_RULE_MODES)

export const deviceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    platform: devicePlatformSchema,
    captureState: deviceCaptureStateSchema,
    createdAt: jstRfc3339Schema,
    updatedAt: jstRfc3339Schema,
  })
  .strict() satisfies z.ZodType<Device>

export const rawEventSchema = z
  .object({
    id: z.string().min(1),
    deviceId: z.string().min(1),
    source: actionLogSourceSchema,
    eventType: rawEventTypeSchema,
    occurredAt: jstRfc3339Schema,
    appName: z.string().min(1).optional(),
    windowTitle: z.string().min(1).optional(),
    url: z.string().url().optional(),
    domain: z.string().min(1).optional(),
    projectName: z.string().min(1).optional(),
    fileName: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    expiresAt: jstRfc3339Schema.optional(),
  })
  .strict() satisfies z.ZodType<RawEvent>

export const activitySessionSchema = z
  .object({
    id: z.string().min(1),
    deviceId: z.string().min(1),
    startedAt: jstRfc3339Schema,
    endedAt: jstRfc3339Schema,
    dateKey: dateKeySchema,
    title: z.string().min(1),
    primaryCategory: activityCategorySchema,
    activityKinds: z.array(z.string().min(1)),
    appNames: z.array(z.string().min(1)),
    domains: z.array(z.string().min(1)),
    projectNames: z.array(z.string().min(1)),
    summary: z.string().min(1).optional(),
    noteIds: z.array(z.string().min(1)),
    openLoopIds: z.array(z.string().min(1)),
    hidden: z.boolean(),
  })
  .strict() satisfies z.ZodType<ActivitySession>

export const dailyActivityLogSchema = z
  .object({
    id: z.string().min(1),
    dateKey: dateKeySchema,
    summary: z.string().min(1),
    mainThemes: z.array(z.string().min(1)),
    noteIds: z.array(z.string().min(1)),
    openLoopIds: z.array(z.string().min(1)),
    reviewQuestions: z.array(z.string().min(1)),
    generatedAt: jstRfc3339Schema,
  })
  .strict() satisfies z.ZodType<DailyActivityLog>

export const weeklyActivityReviewSchema = z
  .object({
    id: z.string().min(1),
    weekKey: weekKeySchema,
    summary: z.string().min(1),
    categoryDurations: z.record(z.string(), z.number().nonnegative()),
    focusThemes: z.array(z.string().min(1)),
    openLoopIds: z.array(z.string().min(1)),
    generatedAt: jstRfc3339Schema,
  })
  .strict() satisfies z.ZodType<WeeklyActivityReview>

export const manualNoteSchema = z
  .object({
    id: z.string().min(1),
    createdAt: jstRfc3339Schema,
    dateKey: dateKeySchema,
    body: z.string().min(1),
    linkedSessionId: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<ManualNote>

export const openLoopSchema = z
  .object({
    id: z.string().min(1),
    createdAt: jstRfc3339Schema,
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    status: openLoopStatusSchema,
    linkedSessionIds: z.array(z.string().min(1)),
  })
  .strict() satisfies z.ZodType<OpenLoop>

export const privacyRuleSchema = z
  .object({
    id: z.string().min(1),
    type: privacyRuleTypeSchema,
    value: z.string().min(1),
    mode: privacyRuleModeSchema,
    enabled: z.boolean(),
    updatedAt: jstRfc3339Schema.optional(),
  })
  .strict() satisfies z.ZodType<PrivacyRule>

export interface RawEventDraft extends Omit<RawEvent, 'occurredAt' | 'expiresAt'> {
  occurredAt: string | Date
  expiresAt?: string | Date
}

export interface ActivitySessionDraft
  extends Omit<ActivitySession, 'startedAt' | 'endedAt' | 'dateKey'> {
  startedAt: string | Date
  endedAt: string | Date
}

export interface ResolvedPrivacyRuleOutcome {
  id: string
  type: PrivacyRule['type']
  value: string
  mode: PrivacyRule['mode']
}

function parseActionLogDate(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid action-log timestamp')
  }
  return date
}

function formatJstRfc3339(value: string | Date) {
  const sourceDate = parseActionLogDate(value)
  const jstDate = new Date(sourceDate.getTime() + JST_OFFSET_MS)
  const year = String(jstDate.getUTCFullYear())
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jstDate.getUTCDate()).padStart(2, '0')
  const hours = String(jstDate.getUTCHours()).padStart(2, '0')
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0')
  const seconds = String(jstDate.getUTCSeconds()).padStart(2, '0')
  const milliseconds = jstDate.getUTCMilliseconds()
  const millisecondSuffix = milliseconds > 0 ? `.${String(milliseconds).padStart(3, '0')}` : ''

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${millisecondSuffix}+09:00`
}

function compareUpdatedAtDesc(left?: string, right?: string) {
  const leftTime = left ? parseActionLogDate(left).getTime() : Number.NEGATIVE_INFINITY
  const rightTime = right ? parseActionLogDate(right).getTime() : Number.NEGATIVE_INFINITY
  return rightTime - leftTime
}

function getPrivacyRulePriority(type: PrivacyRule['type']) {
  switch (type) {
    case 'window_title':
      return 0
    case 'domain':
      return 1
    case 'app':
      return 2
    case 'storage_mode':
      return 3
    default:
      return Number.MAX_SAFE_INTEGER
  }
}

export function toActionLogDateKey(value: string | Date) {
  return getDayKey(parseActionLogDate(value))
}

export function toActionLogWeekKey(value: string | Date) {
  return getWeekKey(parseActionLogDate(value))
}

export function normalizeRawEventDraft(draft: RawEventDraft): RawEvent {
  const occurredAt = formatJstRfc3339(draft.occurredAt)
  const expiresAt = draft.expiresAt
    ? formatJstRfc3339(draft.expiresAt)
    : formatJstRfc3339(addDays(parseActionLogDate(draft.occurredAt), RAW_EVENT_TTL_DAYS))

  return rawEventSchema.parse({
    ...draft,
    occurredAt,
    expiresAt,
  })
}

export function normalizeActivitySessionDraft(draft: ActivitySessionDraft): ActivitySession {
  const startedAt = formatJstRfc3339(draft.startedAt)
  const endedAt = formatJstRfc3339(draft.endedAt)

  return activitySessionSchema.parse({
    ...draft,
    startedAt,
    endedAt,
    dateKey: toActionLogDateKey(draft.startedAt),
  })
}

export function resolvePrivacyRuleOutcome(
  matchedRules: PrivacyRule[],
): ResolvedPrivacyRuleOutcome | null {
  const enabledRules = matchedRules.filter((rule) => rule.enabled)
  if (enabledRules.length === 0) {
    return null
  }

  const sortedRules = [...enabledRules].sort((left, right) => {
    const priorityDiff = getPrivacyRulePriority(left.type) - getPrivacyRulePriority(right.type)
    if (priorityDiff !== 0) {
      return priorityDiff
    }
    return compareUpdatedAtDesc(left.updatedAt, right.updatedAt)
  })

  const selectedRule = sortedRules[0]
  if (!selectedRule) {
    return null
  }

  return {
    id: selectedRule.id,
    type: selectedRule.type,
    value: selectedRule.value,
    mode: selectedRule.mode,
  }
}
