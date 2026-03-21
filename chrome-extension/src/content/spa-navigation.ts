export interface UrlChangeDetector {
  check: (currentUrl: string) => void
}

export function createUrlChangeDetector(
  initialUrl: string,
  onUrlChange: () => void,
): UrlChangeDetector {
  let lastUrl = initialUrl

  return {
    check(currentUrl: string) {
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl
        onUrlChange()
      }
    },
  }
}
