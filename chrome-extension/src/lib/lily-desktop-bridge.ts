export const LILY_DESKTOP_BRIDGE_URL = 'http://127.0.0.1:18765/v1/events'
const LILY_DESKTOP_BRIDGE_TIMEOUT_MS = 2000

type BrowsingBridgeType = 'good' | 'bad'

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

function buildMessageText({
  browsingType,
  xp,
  title,
  domain,
}: Pick<SendBrowsingUserMessageParams, 'browsingType' | 'xp' | 'title' | 'domain'>): string {
  const label = resolveMessageLabel(title, domain)
  if (browsingType === 'good') {
    return `「${label}」で+${xp} XPをゲットしました。`
  }
  return `「${label}」で${xp} XPのペナルティとなりました。`
}

export async function sendBrowsingUserMessageToLilyDesktop({
  browsingType,
  xp,
  title,
  domain,
  category,
}: SendBrowsingUserMessageParams): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort()
  }, LILY_DESKTOP_BRIDGE_TIMEOUT_MS)

  try {
    const response = await fetch(LILY_DESKTOP_BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        eventType: 'user_message',
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
      }),
    })

    return response.ok
  } catch {
    return false
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}
