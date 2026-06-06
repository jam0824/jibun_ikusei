import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

const AUTO_DISMISS_MS = 4000

export function ScrapShareToast() {
  const message = useAppStore((state) => state.scrapShareMessage)
  const clearMessage = useAppStore((state) => state.clearScrapShareMessage)

  useEffect(() => {
    if (!message) {
      return
    }

    const timer = window.setTimeout(() => {
      clearMessage()
    }, AUTO_DISMISS_MS)

    return () => window.clearTimeout(timer)
  }, [message, clearMessage])

  if (!message) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg',
          message.tone === 'danger'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : message.tone === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700',
        )}
      >
        <span className="min-w-0 flex-1 text-sm font-semibold">{message.text}</span>
        <button
          type="button"
          aria-label="閉じる"
          onClick={clearMessage}
          className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-white/60 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
