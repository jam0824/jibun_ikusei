export const LILY_DESKTOP_BRIDGE_URL = 'http://127.0.0.1:18765/v1/events'
const LILY_DESKTOP_BRIDGE_TIMEOUT_MS = 2000

type BrowsingBridgeType = 'good' | 'bad' | 'warning'
type ChromeAudibleTab = {
  tabId: number
  domain: string
}

type SendBrowsingUserMessageParams = {
  browsingType: BrowsingBridgeType
  xp: number
  title?: string
  domain?: string
  category?: string
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
