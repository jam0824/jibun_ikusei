import { describe, expect, it } from 'vitest'

import { getWeekKey } from '@/lib/date'

import {
  activitySessionSchema,
  dailyActivityLogSchema,
  deviceSchema,
  normalizeActivitySessionDraft,
  normalizeRawEventDraft,
  rawEventSchema,
  resolvePrivacyRuleOutcome,
  toActionLogDateKey,
  toActionLogWeekKey,
} from './action-log-contract'

describe('action-log-contract', () => {
  it('accepts devices with captureState instead of captureEnabled', () => {
    expect(
      deviceSchema.parse({
        id: 'device_1',
        name: 'main-pc',
        platform: 'windows',
        captureState: 'paused',
        createdAt: '2026-04-17T09:00:00+09:00',
        updatedAt: '2026-04-17T09:05:00+09:00',
      }),
    ).toMatchObject({
      captureState: 'paused',
    })
  })

  it('derives a JST dateKey from a raw event draft', () => {
    expect(toActionLogDateKey('2026-04-17T23:30:00+09:00')).toBe('2026-04-17')
  })

  it('fills expiresAt to occurredAt + 30 days in JST RFC3339', () => {
    const event = normalizeRawEventDraft({
      id: 'raw_1',
      deviceId: 'device_1',
      source: 'desktop_agent',
      eventType: 'active_window_changed',
      occurredAt: '2026-04-17T09:15:00+09:00',
      appName: 'VS Code',
    })

    expect(event.expiresAt).toBe('2026-05-17T09:15:00+09:00')
  })

  it('derives dateKey from ActivitySession.startedAt in JST', () => {
    const session = normalizeActivitySessionDraft({
      id: 'session_1',
      deviceId: 'device_1',
      startedAt: '2026-04-17T10:00:00+09:00',
      endedAt: '2026-04-17T10:45:00+09:00',
      title: 'Chrome拡張の調査',
      primaryCategory: '仕事',
      activityKinds: ['research'],
      appNames: ['Chrome'],
      domains: ['developer.chrome.com'],
      projectNames: ['self-growth-app'],
      searchKeywords: ['Chrome', 'developer.chrome.com'],
      noteIds: [],
      hidden: false,
    })

    expect(session.dateKey).toBe('2026-04-17')
  })

  it('requires searchKeywords on ActivitySession', () => {
    expect(
      activitySessionSchema.parse({
        id: 'session_1',
        deviceId: 'device_1',
        startedAt: '2026-04-17T10:00:00+09:00',
        endedAt: '2026-04-17T10:45:00+09:00',
        dateKey: '2026-04-17',
        title: 'Chrome拡張の調査',
        primaryCategory: '学習',
        activityKinds: ['調査'],
        appNames: ['Chrome'],
        domains: ['developer.chrome.com'],
        projectNames: ['self-growth-app'],
        searchKeywords: ['Chrome拡張', 'developer.chrome.com'],
        noteIds: [],
        hidden: false,
      }),
    ).toMatchObject({
      searchKeywords: ['Chrome拡張', 'developer.chrome.com'],
    })
  })

  it('reuses the existing ISO week-year helper for week keys', () => {
    const occurredAt = '2027-01-01T12:00:00+09:00'

    expect(toActionLogWeekKey(occurredAt)).toBe(getWeekKey(occurredAt))
    expect(toActionLogWeekKey(occurredAt)).toBe('2026-W53')
  })

  it('accepts url, domain, projectName, fileName, and metadata while rejecting body-like fields', () => {
    expect(
      rawEventSchema.parse({
        id: 'raw_2',
        deviceId: 'device_1',
        source: 'chrome_extension',
        eventType: 'browser_page_changed',
        occurredAt: '2026-04-17T09:15:00+09:00',
        url: 'https://example.com/path',
        domain: 'example.com',
        projectName: 'self-growth-app',
        fileName: 'action-log.ts',
        metadata: {
          elapsedSeconds: 42,
        },
      }),
    ).toMatchObject({
      url: 'https://example.com/path',
      domain: 'example.com',
      projectName: 'self-growth-app',
      fileName: 'action-log.ts',
      metadata: {
        elapsedSeconds: 42,
      },
    })

    expect(() =>
      rawEventSchema.parse({
        id: 'raw_3',
        deviceId: 'device_1',
        source: 'chrome_extension',
        eventType: 'browser_page_changed',
        occurredAt: '2026-04-17T09:15:00+09:00',
        clipboardText: 'secret',
      }),
    ).toThrow()
  })

  it('preserves missing daily log sections for incomplete DailyActivityLog data', () => {
    expect(
      dailyActivityLogSchema.parse({
        id: 'daily_2026-04-17',
        dateKey: '2026-04-17',
        mainThemes: ['調査'],
        noteIds: [],
        reviewQuestions: ['次に何を見るか。'],
        generatedAt: '2026-04-17T22:00:00+09:00',
      }),
    ).toMatchObject({
      summary: undefined,
      questSummary: undefined,
      healthSummary: undefined,
    })
  })

  it('sectionLastFailedAt を保持したまま DailyActivityLog を正規化する', () => {
    expect(
      dailyActivityLogSchema.parse({
        id: 'daily_2026-04-17',
        dateKey: '2026-04-17',
        mainThemes: [],
        noteIds: [],
        reviewQuestions: [],
        generatedAt: '2026-04-17T22:00:00+09:00',
        sectionLastFailedAt: {
          summary: '2026-04-17T21:00:00+09:00',
          healthSummary: '2026-04-17T21:05:00+09:00',
        },
      }),
    ).toMatchObject({
      sectionLastFailedAt: {
        summary: '2026-04-17T21:00:00+09:00',
        healthSummary: '2026-04-17T21:05:00+09:00',
      },
    })
  })

  it('sectionLastFailedAt が未定義でも DailyActivityLog を受け付ける', () => {
    const result = dailyActivityLogSchema.parse({
      id: 'daily_2026-04-17',
      dateKey: '2026-04-17',
      mainThemes: [],
      noteIds: [],
      reviewQuestions: [],
      generatedAt: '2026-04-17T22:00:00+09:00',
    })

    expect(result.sectionLastFailedAt).toBeUndefined()
  })

  it('resolves privacy rules by window_title > domain > app > storage_mode priority', () => {
    const outcome = resolvePrivacyRuleOutcome([
      {
        id: 'rule_storage',
        type: 'storage_mode',
        value: '*',
        mode: 'full_url',
        enabled: true,
        updatedAt: '2026-04-17T09:00:00+09:00',
      },
      {
        id: 'rule_app',
        type: 'app',
        value: 'Chrome',
        mode: 'domain_only',
        enabled: true,
        updatedAt: '2026-04-17T09:05:00+09:00',
      },
      {
        id: 'rule_domain',
        type: 'domain',
        value: 'mail.google.com',
        mode: 'exclude',
        enabled: true,
        updatedAt: '2026-04-17T09:06:00+09:00',
      },
      {
        id: 'rule_window',
        type: 'window_title',
        value: 'Inbox',
        mode: 'exclude',
        enabled: true,
        updatedAt: '2026-04-17T09:07:00+09:00',
      },
    ])

    expect(outcome).toEqual({
      id: 'rule_window',
      type: 'window_title',
      value: 'Inbox',
      mode: 'exclude',
    })
  })

  it('prefers the newest updatedAt among rules of the same type', () => {
    const outcome = resolvePrivacyRuleOutcome([
      {
        id: 'rule_domain_old',
        type: 'domain',
        value: 'docs.example.com',
        mode: 'domain_only',
        enabled: true,
        updatedAt: '2026-04-17T09:00:00+09:00',
      },
      {
        id: 'rule_domain_new',
        type: 'domain',
        value: 'docs.example.com',
        mode: 'full_url',
        enabled: true,
        updatedAt: '2026-04-17T09:10:00+09:00',
      },
    ])

    expect(outcome).toEqual({
      id: 'rule_domain_new',
      type: 'domain',
      value: 'docs.example.com',
      mode: 'full_url',
    })
  })
})
