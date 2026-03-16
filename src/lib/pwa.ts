import { useEffect, useState } from 'react'

function getStandaloneState() {
  if (typeof window === 'undefined') {
    return false
  }

  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true
  )
}

function getOnlineState() {
  if (typeof navigator === 'undefined') {
    return true
  }

  return navigator.onLine
}

function getIsIos() {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function usePwaInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(getStandaloneState)
  const [isOnline, setIsOnline] = useState(getOnlineState)
  const isIos = getIsIos()

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsInstalled(true)
    }

    const handleDisplayModeChange = () => {
      setIsInstalled(getStandaloneState())
    }

    const handleOnlineStatusChange = () => {
      setIsOnline(getOnlineState())
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    window.addEventListener('online', handleOnlineStatusChange)
    window.addEventListener('offline', handleOnlineStatusChange)

    const displayModeQuery = window.matchMedia?.('(display-mode: standalone)')
    displayModeQuery?.addEventListener?.('change', handleDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
      window.removeEventListener('online', handleOnlineStatusChange)
      window.removeEventListener('offline', handleOnlineStatusChange)
      displayModeQuery?.removeEventListener?.('change', handleDisplayModeChange)
    }
  }, [])

  const promptInstall = async () => {
    if (!installPrompt) {
      return { outcome: 'unavailable' as const }
    }

    await installPrompt.prompt()
    const choice = await installPrompt.userChoice

    if (choice.outcome === 'accepted') {
      setInstallPrompt(null)
    }

    return choice
  }

  return {
    isOnline,
    isInstalled,
    isIos,
    canInstall: Boolean(installPrompt) && !isInstalled,
    needsIosInstallHelp: isIos && !isInstalled && !installPrompt,
    promptInstall,
  }
}
