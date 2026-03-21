import type { PageInfo } from '@ext/types/browsing'

/** Extract page metadata from the current document */
export function extractPageInfo(): PageInfo {
  const url = location.href
  let domain = ''
  try {
    domain = new URL(url).hostname
  } catch {
    // ignore
  }

  const title = document.title || ''
  const description =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ?? undefined

  // YouTube-specific: extract channel name
  let channelOrAuthor: string | undefined
  if (domain.includes('youtube.com')) {
    channelOrAuthor =
      document.querySelector('#channel-name a, ytd-channel-name a')?.textContent?.trim() ??
      undefined
  }

  // Use URL path segments as a section hint
  let sectionHint: string | undefined
  try {
    const pathname = new URL(url).pathname
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length > 0) {
      sectionHint = segments.slice(0, 2).join('/')
    }
  } catch {
    // ignore
  }

  return { domain, url, title, description, channelOrAuthor, sectionHint }
}
