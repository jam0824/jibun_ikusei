import type { ScrapArticle, ScrapArticleAddedFrom } from '@/domain/types'
import { toJstIso } from '@/lib/date'
import { createId } from '@/lib/utils'

export const SCRAP_PENDING_SHARE_KEY = 'scrap.pendingShare'

export type ScrapSharePayload = {
  title?: string | null
  text?: string | null
  url?: string | null
}

type CanonicalizedScrapUrl = {
  url: string
  canonicalUrl: string
  domain: string
}

export type ResolvedScrapSharePayload =
  | (CanonicalizedScrapUrl & {
      ok: true
      title: string
      sourceText?: string
    })
  | {
      ok: false
      reason: string
    }

const NO_URL_MESSAGE = 'URLを読み取れませんでした。URLを貼り付けて追加してください。'
const INVALID_URL_MESSAGE = '保存できるURLではありません。'
const URL_PATTERN = /https?:\/\/[^\s<>"']+/i
const ALL_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi
const MAX_SOURCE_TEXT_LENGTH = 1000

function cleanText(value?: string | null) {
  return String(value ?? '').trim()
}

function trimTrailingUrlPunctuation(value: string) {
  return value.replace(/[),.。、，）】」』]+$/u, '')
}

function extractFirstUrl(value?: string | null) {
  const match = cleanText(value).match(URL_PATTERN)
  return match ? trimTrailingUrlPunctuation(match[0]) : ''
}

function stripUrls(value: string) {
  return value.replace(ALL_URL_PATTERN, '').replace(/\s+/g, ' ').trim()
}

function buildCanonicalUrl(url: URL) {
  const protocol = url.protocol.toLowerCase()
  const host = url.host.toLowerCase()
  let pathname = url.pathname || ''
  if (pathname !== '/') {
    pathname = pathname.replace(/\/+$/u, '')
  }
  if (pathname === '/') {
    pathname = ''
  }
  return `${protocol}//${host}${pathname}${url.search}`
}

export function canonicalizeScrapUrl(rawUrl: string): CanonicalizedScrapUrl | null {
  const trimmed = cleanText(rawUrl)
  if (!trimmed) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    parsed.hostname = parsed.hostname.toLowerCase()

    const withoutHash = new URL(parsed.toString())
    withoutHash.hash = ''

    return {
      url: parsed.toString(),
      canonicalUrl: buildCanonicalUrl(withoutHash),
      domain: parsed.hostname.toLowerCase(),
    }
  } catch {
    return null
  }
}

function chooseSharedUrl(payload: ScrapSharePayload) {
  const candidates = [
    cleanText(payload.url),
    extractFirstUrl(payload.text),
    extractFirstUrl(payload.title),
  ].filter(Boolean)

  return candidates[0] ?? ''
}

function chooseSharedTitle(payload: ScrapSharePayload, resolved: CanonicalizedScrapUrl) {
  const title = cleanText(payload.title)
  if (title && canonicalizeScrapUrl(title)?.canonicalUrl !== resolved.canonicalUrl) {
    return title
  }

  const textTitle = stripUrls(cleanText(payload.text))
  return textTitle || resolved.domain
}

export function resolveScrapSharePayload(payload: ScrapSharePayload): ResolvedScrapSharePayload {
  const rawUrl = chooseSharedUrl(payload)
  if (!rawUrl) {
    return { ok: false, reason: NO_URL_MESSAGE }
  }

  const resolved = canonicalizeScrapUrl(rawUrl)
  if (!resolved) {
    return { ok: false, reason: INVALID_URL_MESSAGE }
  }

  const title = chooseSharedTitle(payload, resolved)
  const sourceText = [payload.title, payload.text, payload.url]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_SOURCE_TEXT_LENGTH)

  return {
    ok: true,
    ...resolved,
    title,
    sourceText: sourceText || undefined,
  }
}

export function buildScrapArticleDraft(
  input: {
    url: string
    title?: string
    memo?: string
    sourceText?: string
    addedFrom: ScrapArticleAddedFrom
  },
  options: {
    id?: string
    now?: Date
  } = {},
): ScrapArticle {
  const resolved = canonicalizeScrapUrl(input.url)
  if (!resolved) {
    throw new Error(INVALID_URL_MESSAGE)
  }

  const timestamp = toJstIso(options.now ?? new Date())
  return {
    id: options.id ?? createId('scrap'),
    url: resolved.url,
    canonicalUrl: resolved.canonicalUrl,
    title: cleanText(input.title) || resolved.domain,
    domain: resolved.domain,
    sourceText: input.sourceText ? input.sourceText.slice(0, MAX_SOURCE_TEXT_LENGTH) : undefined,
    memo: cleanText(input.memo) || undefined,
    status: 'unread',
    addedFrom: input.addedFrom,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function readPendingScrapShare(): ScrapSharePayload | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.sessionStorage.getItem(SCRAP_PENDING_SHARE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as ScrapSharePayload
  } catch {
    window.sessionStorage.removeItem(SCRAP_PENDING_SHARE_KEY)
    return null
  }
}

export function writePendingScrapShare(payload: ScrapSharePayload) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(SCRAP_PENDING_SHARE_KEY, JSON.stringify(payload))
}

export function clearPendingScrapShare() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(SCRAP_PENDING_SHARE_KEY)
}
