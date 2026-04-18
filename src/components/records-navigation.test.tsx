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
  it('renders the current route with the same soft violet tone used elsewhere in the app', () => {
    render(
      <MemoryRouter initialEntries={['/records/activity/today']}>
        <ActivityLogNav />
      </MemoryRouter>,
    )

    const todayLink = screen.getByRole('link', { name: '今日' })
    const calendarLink = screen.getByRole('link', { name: 'カレンダー' })

    expect(todayLink).toHaveAttribute('aria-current', 'page')
    expect(todayLink).toHaveClass('bg-violet-50')
    expect(todayLink).toHaveClass('text-violet-700')
    expect(todayLink).toHaveClass('border-violet-200')
    expect(calendarLink).toHaveClass('text-slate-700')
    expect(screen.queryByRole('link', { name: '閲覧' })).not.toBeInTheDocument()
  })
})
