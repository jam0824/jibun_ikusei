import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
  it('renders good, other, and bad segments with correct proportions', () => {
    render(<ProgressBar goodSeconds={3600} otherSeconds={1800} badSeconds={600} />)

    const goodBar = screen.getByTestId('bar-good')
    const otherBar = screen.getByTestId('bar-other')
    const badBar = screen.getByTestId('bar-bad')

    // Total = 6000, good = 60%, other = 30%, bad = 10%
    expect(goodBar.style.width).toBe('60%')
    expect(otherBar.style.width).toBe('30%')
    expect(badBar.style.width).toBe('10%')
  })

  it('renders all zero as empty bar', () => {
    render(<ProgressBar goodSeconds={0} otherSeconds={0} badSeconds={0} />)

    const goodBar = screen.getByTestId('bar-good')
    expect(goodBar.style.width).toBe('0%')
  })

  it('uses correct colors for segments', () => {
    render(<ProgressBar goodSeconds={100} otherSeconds={100} badSeconds={100} />)

    const goodBar = screen.getByTestId('bar-good')
    const badBar = screen.getByTestId('bar-bad')

    expect(goodBar.style.backgroundColor).toContain('rgb')
    expect(badBar.style.backgroundColor).toContain('rgb')
  })

  it('handles only good browsing', () => {
    render(<ProgressBar goodSeconds={1000} otherSeconds={0} badSeconds={0} />)

    const goodBar = screen.getByTestId('bar-good')
    expect(goodBar.style.width).toBe('100%')
  })
})
