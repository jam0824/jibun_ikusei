import type { PageInfo } from '@ext/types/browsing'

/** トラッキング用パラメータ（キャッシュキーから除外） */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'si',
  'feature',
  't',
])

/**
 * ページ情報からキャッシュキーを生成する。
 * pathname + コンテンツ識別に必要なクエリパラメータを含む。
 * トラッキング用パラメータは除外する。
 */
export function buildCacheKey(pageInfo: PageInfo): string {
  try {
    const url = new URL(pageInfo.url)
    const pathname = url.pathname

    // コンテンツ識別に必要なクエリパラメータを抽出（トラッキング系を除外）
    const relevantParams = new URLSearchParams()
    for (const [key, value] of url.searchParams.entries()) {
      if (!TRACKING_PARAMS.has(key)) {
        relevantParams.set(key, value)
      }
    }

    // パラメータをソートして安定したキーにする
    relevantParams.sort()
    const search = relevantParams.toString()
    const suffix = search ? `?${search}` : ''

    return `${pageInfo.domain}:${pathname}${suffix}`
  } catch {
    return `${pageInfo.domain}:/`
  }
}
