import { CalendarDays, ScrollText, Search, Sparkles } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function RecordsSectionTabs({
  active,
  questHref = '/records/quests?range=today',
}: {
  active: 'quests' | 'activity'
  questHref?: string
}) {
  const tabs = [
    { key: 'quests' as const, label: '成長記録', to: questHref, icon: ScrollText },
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
              'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition',
              active === tab.key
                ? 'border-violet-600 bg-violet-600 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
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
  const items = [
    { label: '今日', to: '/records/activity/today', icon: Sparkles },
    { label: 'カレンダー', to: '/records/activity/calendar', icon: CalendarDays },
    { label: '検索', to: '/records/activity/search', icon: Search },
    {
      label: '週次レビュー',
      to: year ? `/records/activity/review/year?year=${year}` : '/records/activity/review/year',
      icon: ScrollText,
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
                'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition',
                isActive
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </NavLink>
        )
      })}
    </div>
  )
}
