export const LILY_DESKTOP_BRIDGE_URL = 'http://127.0.0.1:18765/v1/events'
const LILY_DESKTOP_BRIDGE_TIMEOUT_MS = 2000
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

type BrowsingBridgeType = 'good' | 'bad' | 'warning'
type ChromeAudibleTab = {
  tabId: number
  domain: string
}
export type BrowserActionLogTrigger = 'tab_activated' | 'url_changed' | 'window_focus' | 'flush'

type SendBrowsingUserMessageParams = {
  browsingType: BrowsingBridgeType
  xp: number
  title?: string
  domain?: string
  category?: string
}

type BrowserActionLogEventParams = {
  tabId: number
  url: string
  domain: string
  title: string | null
  trigger: BrowserActionLogTrigger
  elapsedSeconds?: number
  category?: string | null
  isGrowth?: boolean | null
  cacheKey?: string | null
}

function resolveMessageLabel(title?: string, domain?: string): string {
  return title || domain || '閲覧活動'
}

function buildWarningMessageText(domain?: string): string {
  if (domain) {
    return `Lily: ${domain} をあと10分見続けるとペナルティです。`
  }
  return 'Lily: もうすぐ1時間です。このまま続けるか、一度切り上げるか考えてみましょう。'
}

function buildMessageText({
  browsingType,
  xp,
  title,
  domain,
}: Pick<SendBrowsingUserMessageParams, 'browsingType' | 'xp' | 'title' | 'domain'>): string {
  if (browsingType === 'warning') {
    return buildWarningMessageText(domain)
  }

  const label = resolveMessageLabel(title, domain)
  if (browsingType === 'good') {
    return `「${label}」で+${xp} XPをゲットしました。`
  }
  return `「${label}」で${xp} XPのペナルティとなりました。`
}

function normalizeBridgeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase()
  return normalized.startsWith('www.') ? normalized.slice(4) : normalized
}

function buildJstOccurredAt(date = new Date()): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  const year = String(jst.getUTCFullYear())
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jst.getUTCDate()).padStart(2, '0')
  const hours = String(jst.getUTCHours()).padStart(2, '0')
  const minutes = String(jst.getUTCMinutes()).padStart(2, '0')
  const seconds = String(jst.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`
}

async function sendBridgeEvent(body: object): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort()
  }, LILY_DESKTOP_BRIDGE_TIMEOUT_MS)

  try {
    const response = await fetch(LILY_DESKTOP_BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    })

    return response.ok
  } catch {
    return false
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

export async function sendBrowsingSystemMessageToLilyDesktop({
  browsingType,
  xp,
  title,
  domain,
  category,
}: SendBrowsingUserMessageParams): Promise<boolean> {
  return sendBridgeEvent({
    eventType: 'system_message',
    source: 'chrome_extension_browsing',
    eventId: crypto.randomUUID(),
    payload: {
      text: buildMessageText({ browsingType, xp, title, domain }),
    },
    metadata: {
      browsingType,
      domain: domain ?? null,
      category: category ?? null,
      xp,
      title: title ?? null,
    },
  })
}

export async function sendChromeAudibleTabsToLilyDesktop(
  audibleTabs: ChromeAudibleTab[],
): Promise<boolean> {
  return sendBridgeEvent({
    eventType: 'chrome_audible_tabs',
    source: 'chrome_extension_audible_tabs',
    eventId: crypto.randomUUID(),
    payload: {
      audibleTabs: audibleTabs.map((tab) => ({
        tabId: tab.tabId,
        domain: normalizeBridgeDomain(tab.domain),
      })),
    },
  })
}

function buildBrowserActionLogMetadata({
  trigger,
  elapsedSeconds,
  category,
  isGrowth,
  cacheKey,
}: Pick<
  BrowserActionLogEventParams,
  'trigger' | 'elapsedSeconds' | 'category' | 'isGrowth' | 'cacheKey'
>) {
  return {
    trigger,
    ...(typeof elapsedSeconds === 'number' ? { elapsedSeconds } : {}),
    category: category ?? null,
    isGrowth: isGrowth ?? null,
    cacheKey: cacheKey ?? null,
  }
}

async function sendBrowserActionLogEvent(
  eventType: 'browser_page_changed' | 'heartbeat',
  params: BrowserActionLogEventParams,
): Promise<boolean> {
  return sendBridgeEvent({
    eventType,
    source: 'chrome_extension',
    eventId: crypto.randomUUID(),
    occurredAt: buildJstOccurredAt(),
    payload: {
      tabId: params.tabId,
      url: params.url,
      domain: params.domain,
      title: params.title,
    },
    metadata: buildBrowserActionLogMetadata(params),
  })
}

export async function sendBrowserPageChangedToLilyDesktop(
  params: Omit<BrowserActionLogEventParams, 'elapsedSeconds'>,
): Promise<boolean> {
  return sendBrowserActionLogEvent('browser_page_changed', params)
}

export async function sendBrowserHeartbeatToLilyDesktop(
  params: BrowserActionLogEventParams,
): Promise<boolean> {
  return sendBrowserActionLogEvent('heartbeat', params)
}
