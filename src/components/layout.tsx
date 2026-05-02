import { type ReactNode, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Bell, Bookmark, Home, ListTodo, Plus, ScrollText, Sparkles, Utensils } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui'

export function SectionHeader({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {action}
    </div>
  )
}

export function AppHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/85 px-4 pb-4 pt-4 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500">自分育成アプリ</div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{title}</h1>
          <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          <NavLink to="/lily" aria-label="リリィと話す">
            <img src={`${import.meta.env.BASE_URL}lily/face.png`} alt="リリィ" className="h-10 w-10 rounded-full object-cover" />
          </NavLink>
          {action}
        </div>
      </div>
    </header>
  )
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="icon" className="rounded-2xl" onClick={onClick}>
      <Bell className="h-5 w-5" />
    </Button>
  )
}

export function Screen({
  title,
  subtitle,
  action,
  children,
  withBottomNav = true,
}: {
  title: string
  subtitle: string
  action?: ReactNode
  children: ReactNode
  withBottomNav?: boolean
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(167,139,250,0.15),_transparent_35%),linear-gradient(to_bottom,_#f5f3ff,_#f8fafc_38%,_#f1f5f9)]">
      <AppHeader title={title} subtitle={subtitle} action={action} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4">{children}</main>
      {withBottomNav ? <BottomNav /> : null}
    </div>
  )
}

export function BottomNav() {
  const navigate = useNavigate()
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)

  useEffect(() => {
    if (!isAddMenuOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAddMenuOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAddMenuOpen])

  const leadingItems = [
    { to: '/', label: 'ホーム', icon: Home, end: true },
    { to: '/quests', label: 'クエスト', icon: ListTodo },
  ]

  const trailingItems = [
    { to: '/growth', label: '成長', icon: Sparkles },
    { to: '/records', label: '記録', icon: ScrollText },
  ]

  return (
    <>
      {isAddMenuOpen ? (
        <>
          <button
            type="button"
            aria-label="追加メニューを閉じる"
            className="fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-[2px]"
            onClick={() => setIsAddMenuOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-24 z-40 px-4">
            <div className="mx-auto max-w-md rounded-[2rem] border border-slate-200 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
              <div className="px-2 pb-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add</div>
                <div className="mt-1 text-lg font-black text-slate-900">何を追加しますか？</div>
              </div>
              <div className="grid gap-3">
                <button
                  type="button"
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-violet-200 hover:bg-violet-50/40"
                  onClick={() => {
                    setIsAddMenuOpen(false)
                    navigate('/quests/new')
                  }}
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">クエスト追加</div>
                    <div className="mt-1 text-xs text-slate-500">新しい行動や習慣を登録します。</div>
                  </div>
                  <ListTodo className="h-5 w-5 text-violet-600" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-violet-200 hover:bg-violet-50/40"
                  onClick={() => {
                    setIsAddMenuOpen(false)
                    navigate('/meal')
                  }}
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">食事登録</div>
                    <div className="mt-1 text-xs text-slate-500">栄養の記録を追加します。</div>
                  </div>
                  <Utensils className="h-5 w-5 text-violet-600" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-violet-200 hover:bg-violet-50/40"
                  onClick={() => {
                    setIsAddMenuOpen(false)
                    navigate('/records/scraps/new')
                  }}
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">記事スクラップ</div>
                    <div className="mt-1 text-xs text-slate-500">あとで読むURLを保存します。</div>
                  </div>
                  <Bookmark className="h-5 w-5 text-violet-600" />
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <nav className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-2">
        {leadingItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition',
                  isActive
                    ? 'bg-violet-50 text-violet-700'
                    : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
        <Button
          size="icon"
          aria-label="追加メニューを開く"
          className="mx-auto h-12 w-12 rounded-full border-violet-500 bg-violet-600 shadow-lg shadow-violet-300 hover:bg-violet-700"
          onClick={() => setIsAddMenuOpen(true)}
        >
          <Plus className="h-5 w-5" />
        </Button>
        {trailingItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition',
                  isActive
                    ? 'bg-violet-50 text-violet-700'
                    : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </div>
      </nav>
    </>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-10">
      <div className="w-full rounded-[2rem] border border-dashed border-violet-200 bg-white/90 p-8 text-center shadow-sm">
        <div className="text-lg font-semibold text-slate-900">{title}</div>
        <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
        {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
      </div>
    </div>
  )
}
