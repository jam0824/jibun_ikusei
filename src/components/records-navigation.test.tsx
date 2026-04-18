import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActivityLogNav, RecordsSectionTabs } from '@/components/records-navigation'

describe('RecordsSectionTabs', () => {
  it('renders the active activity tab with the same soft violet tone used elsewhere in the app', () => {
    render(
      <MemoryRouter>
        <RecordsSectionTabs active="activity" />
      </MemoryRouter>,
    )

    const activityTab = screen.getByRole('link', { name: '行動ログ' })
    const questTab = screen.getByRole('link', { name: '成長記録' })

    expect(activityTab).toHaveClass('bg-violet-50')
    expect(activityTab).toHaveClass('text-violet-700')
    expect(activityTab).toHaveClass('border-violet-200')
    expect(questTab).toHaveClass('text-slate-700')
  })
})

describe('ActivityLogNav', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-17T09:00:00+09:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the current route with the same soft violet tone used elsewhere in the app', () => {
    render(
      <MemoryRouter initialEntries={['/records/activity/today']}>
        <ActivityLogNav />
      </MemoryRouter>,
    )

    const todayLink = screen.getByRole('link', { name: '今日' })
    const yesterdayLink = screen.getByRole('link', { name: '昨日' })
    const calendarLink = screen.getByRole('link', { name: 'カレンダー' })

    expect(
      screen
        .getAllByRole('link')
        .map((link) => link.textContent?.trim())
        .filter(Boolean),
    ).toEqual(['今日', '昨日', 'カレンダー', '検索', '週次レビュー'])
    expect(todayLink).toHaveAttribute('aria-current', 'page')
    expect(todayLink).toHaveClass('bg-violet-50')
    expect(todayLink).toHaveClass('text-violet-700')
    expect(todayLink).toHaveClass('border-violet-200')
    expect(yesterdayLink).toHaveAttribute('href', '/records/activity/day/2026-04-16')
    expect(yesterdayLink).toHaveClass('text-slate-700')
    expect(calendarLink).toHaveClass('text-slate-700')
    expect(screen.queryByRole('link', { name: '閲覧' })).not.toBeInTheDocument()
  })

  it('marks yesterday active on the JST previous-day screen and preserves the current view param', () => {
    render(
      <MemoryRouter initialEntries={['/records/activity/day/2026-04-16?view=event']}>
        <ActivityLogNav />
      </MemoryRouter>,
    )

    const todayLink = screen.getByRole('link', { name: '今日' })
    const yesterdayLink = screen.getByRole('link', { name: '昨日' })

    expect(todayLink).toHaveAttribute('href', '/records/activity/today?view=event')
    expect(yesterdayLink).toHaveAttribute('href', '/records/activity/day/2026-04-16?view=event')
    expect(yesterdayLink).toHaveAttribute('aria-current', 'page')
    expect(yesterdayLink).toHaveClass('bg-violet-50')
    expect(todayLink).toHaveClass('text-slate-700')
  })

  it('does not mark yesterday active for other day routes', () => {
    render(
      <MemoryRouter initialEntries={['/records/activity/day/2026-04-15']}>
        <ActivityLogNav />
      </MemoryRouter>,
    )

    const yesterdayLink = screen.getByRole('link', { name: '昨日' })

    expect(yesterdayLink).not.toHaveAttribute('aria-current', 'page')
    expect(yesterdayLink).toHaveClass('text-slate-700')
  })
})
