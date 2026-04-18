import { CalendarDays, Search, Sparkles, ScrollText } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function RecordsSectionTabs({
  active,
  growthHref = '/records/growth?range=today',
}: {
  active: 'growth' | 'activity'
  growthHref?: string
}) {
  const baseTabClass =
    'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200'

  const tabs = [
    { key: 'growth' as const, label: '成長記録', to: growthHref, icon: ScrollText },
    { key: 'activity' as const, label: '行動ログ', to: '/records/activity/today', icon: Sparkles },
  ]

  return (
    <div className="scrollbar-hide mb-4 flex gap-2 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <NavLink
            key={tab.key}
            to={tab.to}
            className={cn(
              baseTabClass,
              active === tab.key
                ? 'border-violet-200 bg-violet-50 text-violet-700 shadow-sm shadow-violet-100/80'
                : 'border-slate-200 bg-white text-slate-700 shadow-sm shadow-slate-200/70 hover:border-violet-200 hover:text-slate-900 hover:shadow-md',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {tab.label}
          </NavLink>
        )
      })}
    </div>
  )
}

export function ActivityLogNav({
  year,
}: {
  year?: number
}) {
  const baseNavClass =
    'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200'

  const items = [
    { label: '今日', to: '/records/activity/today', icon: Sparkles },
    { label: 'カレンダー', to: '/records/activity/calendar', icon: CalendarDays },
    { label: '検索', to: '/records/activity/search', icon: Search },
    {
      label: '週次レビュー',
      to: year ? `/records/activity/review/year?year=${year}` : '/records/activity/review/year',
      icon: Sparkles,
    },
  ]

  return (
    <div className="scrollbar-hide mb-4 flex gap-2 overflow-x-auto pb-1">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                baseNavClass,
                isActive
                  ? 'border-violet-200 bg-violet-50 text-violet-700 shadow-sm shadow-violet-100/80'
                  : 'border-slate-200 bg-white text-slate-700 shadow-sm shadow-slate-200/70 hover:border-violet-200 hover:text-slate-900 hover:shadow-md',
              )
            }
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {item.label}
          </NavLink>
        )
      })}
    </div>
  )
}
