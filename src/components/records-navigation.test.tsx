import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActivityLogNav, RecordsSectionTabs } from '@/components/records-navigation'

describe('RecordsSectionTabs', () => {
  it('renders the active activity tab with a high-contrast selected style', () => {
    render(
      <MemoryRouter>
        <RecordsSectionTabs active="activity" />
      </MemoryRouter>,
    )

    const activityTab = screen.getByRole('link', { name: '行動ログ' })
    const questTab = screen.getByRole('link', { name: '成長記録' })

    expect(activityTab).toHaveClass('text-white')
    expect(activityTab).toHaveClass('from-violet-700')
    expect(activityTab).toHaveClass('ring-violet-300/70')
    expect(questTab).toHaveClass('text-slate-700')
  })
})

describe('ActivityLogNav', () => {
  it('renders the current route with a readable selected style', () => {
    render(
      <MemoryRouter initialEntries={['/records/activity/today']}>
        <ActivityLogNav />
      </MemoryRouter>,
    )

    const todayLink = screen.getByRole('link', { name: '今日' })
    const calendarLink = screen.getByRole('link', { name: 'カレンダー' })

    expect(todayLink).toHaveAttribute('aria-current', 'page')
    expect(todayLink).toHaveClass('bg-slate-950')
    expect(todayLink).toHaveClass('text-slate-50')
    expect(calendarLink).toHaveClass('text-slate-700')
  })
})
