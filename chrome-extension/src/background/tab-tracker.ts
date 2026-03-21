export interface TabElapsedResult {
  tabId: number
  url: string
  domain: string
  elapsedSeconds: number
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname
    }
    return ''
  } catch {
    return ''
  }
}

export class TabTracker {
  private activeTabId: number | null = null
  private activeUrl: string = ''
  private activeDomain: string = ''
  private startedAt: number | null = null

  /** Called when user switches to a different tab. Returns elapsed info for previous tab. */
  onTabActivated(tabId: number, url: string): TabElapsedResult | null {
    const result = this.stopCurrent()
    this.startTracking(tabId, url)
    return result
  }

  /** Called when browser window loses focus. Returns elapsed info for current tab. */
  onWindowBlur(): TabElapsedResult | null {
    const result = this.stopCurrent()
    // Keep tab info but pause timing
    return result
  }

  /** Called when browser window regains focus. Resumes timing for the given tab. */
  onWindowFocus(tabId: number, url: string): void {
    this.startTracking(tabId, url)
  }

  /** Called when the active tab navigates to a new URL. Returns elapsed for old URL. */
  onUrlChanged(tabId: number, newUrl: string): TabElapsedResult | null {
    if (tabId !== this.activeTabId || this.startedAt === null) {
      return null
    }
    const result = this.stopCurrent()
    this.startTracking(tabId, newUrl)
    return result
  }

  /** Flush current elapsed time without stopping tracking. Resets the start time. */
  flush(): TabElapsedResult | null {
    if (this.activeTabId === null || this.startedAt === null) {
      return null
    }
    const now = Date.now()
    const elapsedMs = now - this.startedAt
    const result: TabElapsedResult = {
      tabId: this.activeTabId,
      url: this.activeUrl,
      domain: this.activeDomain,
      elapsedSeconds: Math.floor(elapsedMs / 1000),
    }
    this.startedAt = now
    return result
  }

  private stopCurrent(): TabElapsedResult | null {
    if (this.activeTabId === null || this.startedAt === null) {
      return null
    }
    const now = Date.now()
    const elapsedMs = now - this.startedAt
    const result: TabElapsedResult = {
      tabId: this.activeTabId,
      url: this.activeUrl,
      domain: this.activeDomain,
      elapsedSeconds: Math.floor(elapsedMs / 1000),
    }
    this.activeTabId = null
    this.activeUrl = ''
    this.activeDomain = ''
    this.startedAt = null
    return result
  }

  private startTracking(tabId: number, url: string): void {
    this.activeTabId = tabId
    this.activeUrl = url
    this.activeDomain = extractDomain(url)
    this.startedAt = Date.now()
  }
}
