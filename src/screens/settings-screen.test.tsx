import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsScreen } from '@/screens/settings-screen'

vi.mock('@/lib/pwa', () => ({
  usePwaInstall: () => ({
    canInstall: false,
    isInstalled: false,
    isOnline: true,
    needsIosInstallHelp: false,
    promptInstall: vi.fn(),
  }),
}))

vi.mock('@/lib/auth', () => ({
  getUserEmail: vi.fn().mockResolvedValue('test@example.com'),
  logout: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  getActionLogDevices: vi.fn(),
  getActionLogPrivacyRules: vi.fn(),
  putActionLogDevice: vi.fn(),
  putActionLogPrivacyRules: vi.fn(),
}))

import * as api from '@/lib/api-client'

describe('settings screen action-log section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getActionLogDevices).mockResolvedValue([
      {
        id: 'device_main',
        name: 'Main PC',
        platform: 'windows',
        captureState: 'active',
        createdAt: '2026-04-18T08:00:00+09:00',
        updatedAt: '2026-04-18T08:00:00+09:00',
      },
    ])
    vi.mocked(api.getActionLogPrivacyRules).mockResolvedValue([
      {
        id: 'rule_app_slack',
        type: 'app',
        value: 'Slack.exe',
        mode: 'exclude',
        enabled: true,
        updatedAt: '2026-04-18T08:00:00+09:00',
      },
      {
        id: 'rule_domain_mail',
        type: 'domain',
        value: 'mail.google.com',
        mode: 'exclude',
        enabled: true,
        updatedAt: '2026-04-18T08:00:00+09:00',
      },
      {
        id: 'rule_storage_url',
        type: 'storage_mode',
        value: 'default_url_storage',
        mode: 'domain_only',
        enabled: true,
        updatedAt: '2026-04-18T08:00:00+09:00',
      },
      {
        id: 'rule_ai_handling',
        type: 'storage_mode',
        value: 'default_ai_handling',
        mode: 'ai_disabled',
        enabled: true,
        updatedAt: '2026-04-18T08:00:00+09:00',
      },
    ])
    vi.mocked(api.putActionLogDevice).mockResolvedValue({
      id: 'device_main',
      name: 'Main PC',
      platform: 'windows',
      captureState: 'paused',
      createdAt: '2026-04-18T08:00:00+09:00',
      updatedAt: '2026-04-18T08:10:00+09:00',
    })
    vi.mocked(api.putActionLogPrivacyRules).mockResolvedValue({ updated: 4 })
  })

  it('loads action-log devices and privacy rules and saves normalized changes', async () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '行動ログ' })).toBeInTheDocument()
    expect(api.getActionLogDevices).toHaveBeenCalledTimes(1)
    expect(api.getActionLogPrivacyRules).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Slack.exe')).toBeInTheDocument()
    expect(screen.getByText('mail.google.com')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Capture state Main PC'), {
      target: { value: 'paused' },
    })
    fireEvent.change(screen.getByLabelText('Excluded app input'), {
      target: { value: 'Discord.exe' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add excluded app' }))
    fireEvent.change(screen.getByLabelText('Excluded domain input'), {
      target: { value: 'chat.openai.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add excluded domain' }))
    fireEvent.change(screen.getByLabelText('URL storage mode'), {
      target: { value: 'full_url' },
    })
    fireEvent.change(screen.getByLabelText('AI handling mode'), {
      target: { value: 'ai_summary_only' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save action-log settings' }))

    await waitFor(() => {
      expect(api.putActionLogDevice).toHaveBeenCalledWith('device_main', {
        captureState: 'paused',
      })
    })
    expect(api.putActionLogPrivacyRules).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'app',
          value: 'Slack.exe',
          mode: 'exclude',
        }),
        expect.objectContaining({
          type: 'app',
          value: 'Discord.exe',
          mode: 'exclude',
        }),
        expect.objectContaining({
          type: 'domain',
          value: 'mail.google.com',
          mode: 'exclude',
        }),
        expect.objectContaining({
          type: 'domain',
          value: 'chat.openai.com',
          mode: 'exclude',
        }),
        expect.objectContaining({
          type: 'storage_mode',
          value: 'default_url_storage',
          mode: 'full_url',
        }),
        expect.objectContaining({
          type: 'storage_mode',
          value: 'default_ai_handling',
          mode: 'ai_summary_only',
        }),
      ]),
    )
  })
})
