import { extractPageInfo } from './page-info-extractor'
import { createUrlChangeDetector } from './spa-navigation'

function sendPageInfo() {
  const pageInfo = extractPageInfo()
  chrome.runtime.sendMessage({ type: 'PAGE_INFO', payload: pageInfo }).catch(() => {
    // Background may not be ready yet
  })
}

// Send page info to background on load
sendPageInfo()

// Detect SPA navigation (pushState/replaceState/popstate)
const detector = createUrlChangeDetector(location.href, sendPageInfo)
const originalPushState = history.pushState.bind(history)
const originalReplaceState = history.replaceState.bind(history)
history.pushState = (...args: Parameters<typeof history.pushState>) => {
  originalPushState(...args)
  detector.check(location.href)
}
history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
  originalReplaceState(...args)
  detector.check(location.href)
}
window.addEventListener('popstate', () => detector.check(location.href))

// Listen for toast notification messages from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SHOW_TOAST') {
    showToast(message.payload as { text: string; variant: 'good' | 'warning' | 'bad' })
  }
})

function showToast(payload: { text: string; variant: 'good' | 'warning' | 'bad' }) {
  // Create shadow DOM container for style isolation
  let host = document.getElementById('jibun-ikusei-toast-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'jibun-ikusei-toast-host'
    document.body.appendChild(host)
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })

  const colors = {
    good: { bg: '#e0f2f1', border: '#00897b', text: '#004d40' },
    warning: { bg: '#fff3e0', border: '#f57c00', text: '#e65100' },
    bad: { bg: '#ffebee', border: '#e53935', text: '#b71c1c' },
  }
  const c = colors[payload.variant]

  const toast = document.createElement('div')
  toast.setAttribute(
    'style',
    `position:fixed;top:16px;right:16px;z-index:2147483647;padding:12px 16px;border-radius:8px;font-family:sans-serif;font-size:14px;max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,0.15);background:${c.bg};border-left:4px solid ${c.border};color:${c.text};opacity:0;transition:opacity 0.3s;cursor:pointer;`,
  )
  toast.textContent = payload.text

  shadow.appendChild(toast)

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1'
  })

  // Auto-dismiss after 5 seconds
  const dismiss = () => {
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 300)
  }
  toast.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {})
    dismiss()
  })
  setTimeout(dismiss, 5000)
}
