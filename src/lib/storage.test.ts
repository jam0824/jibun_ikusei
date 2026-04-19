import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  getUser: vi.fn(),
  getQuests: vi.fn(),
  getCompletions: vi.fn(),
  getSkills: vi.fn(),
  getSettings: vi.fn(),
  getAiConfig: vi.fn(),
  getMeta: vi.fn(),
  getMessages: vi.fn(),
  getDictionary: vi.fn(),
}))

import * as api from '@/lib/api-client'
import { loadFromCloud } from '@/lib/storage'

describe('storage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('keeps loading cloud state even when legacy archived quests are malformed', async () => {
    vi.mocked(api.getUser).mockResolvedValue({
      id: 'local_user',
      level: 9,
      totalXp: 844,
      createdAt: '2026-03-16T15:32:48.787Z',
      updatedAt: '2026-04-19T22:55:10.731Z',
    })
    vi.mocked(api.getQuests).mockResolvedValue([
      {
        id: 'quest_valid',
        title: '洗濯ものたたみ',
        xpReward: 3,
        questType: 'repeatable',
        skillMappingMode: 'ai_auto',
        cooldownMinutes: 30,
        dailyCompletionCap: 1,
        defaultSkillId: 'skill_housework',
        updatedAt: '2026-03-29T13:40:41.841Z',
      },
      {
        id: 'quest_archived_broken',
        status: 'archived',
        updatedAt: '2026-04-05T06:22:05.857Z',
      } as never,
    ])
    vi.mocked(api.getCompletions).mockResolvedValue([
      {
        id: 'completion_valid',
        questId: 'quest_valid',
        clientRequestId: 'req_completion_valid',
        completedAt: '2026-04-20T07:55:10+09:00',
        userXpAwarded: 3,
        skillResolutionStatus: 'pending',
        createdAt: '2026-04-20T07:55:10+09:00',
      },
    ])
    vi.mocked(api.getSkills).mockResolvedValue([
      {
        id: 'skill_housework',
        name: '家事',
        normalizedName: '家事',
        category: '生活',
        level: 1,
        totalXp: 0,
        source: 'manual',
        status: 'active',
        createdAt: '2026-03-29T13:40:41.841Z',
        updatedAt: '2026-03-29T13:40:41.841Z',
      },
    ])
    vi.mocked(api.getSettings).mockResolvedValue(null)
    vi.mocked(api.getAiConfig).mockResolvedValue(null)
    vi.mocked(api.getMeta).mockResolvedValue(null)
    vi.mocked(api.getMessages).mockResolvedValue([])
    vi.mocked(api.getDictionary).mockResolvedValue([])

    const cloud = await loadFromCloud()

    expect(cloud).not.toBeNull()
    expect(cloud?.quests.some((quest) => quest.id === 'quest_archived_broken')).toBe(false)
    expect(cloud?.quests.find((quest) => quest.id === 'quest_valid')).toEqual(
      expect.objectContaining({
        id: 'quest_valid',
        title: '洗濯ものたたみ',
        status: 'active',
        privacyMode: 'normal',
      }),
    )
    expect(cloud?.user.totalXp).toBe(3)
    expect(cloud?.completions).toHaveLength(1)
  })

  it('keeps loading cloud state even when merged skills are missing display fields', async () => {
    vi.mocked(api.getUser).mockResolvedValue({
      id: 'local_user',
      level: 2,
      totalXp: 8,
      createdAt: '2026-03-16T15:32:48.787Z',
      updatedAt: '2026-04-19T22:55:10.731Z',
    })
    vi.mocked(api.getQuests).mockResolvedValue([
      {
        id: 'quest_valid',
        title: '朝の散歩',
        description: '',
        xpReward: 8,
        questType: 'repeatable',
        skillMappingMode: 'fixed',
        fixedSkillId: 'skill_walk_active',
        status: 'active',
        privacyMode: 'normal',
        pinned: false,
        createdAt: '2026-04-19T07:00:00+09:00',
        updatedAt: '2026-04-19T07:00:00+09:00',
      },
    ])
    vi.mocked(api.getCompletions).mockResolvedValue([
      {
        id: 'completion_valid',
        questId: 'quest_valid',
        clientRequestId: 'req_completion_valid',
        completedAt: '2026-04-20T07:55:10+09:00',
        userXpAwarded: 8,
        skillXpAwarded: 8,
        resolvedSkillId: 'skill_walk_merged',
        skillResolutionStatus: 'resolved',
        createdAt: '2026-04-20T07:55:10+09:00',
      },
    ])
    vi.mocked(api.getSkills).mockResolvedValue([
      {
        id: 'skill_walk_active',
        name: '散歩',
        normalizedName: '散歩',
        category: '運動',
        level: 1,
        totalXp: 0,
        source: 'manual',
        status: 'active',
        createdAt: '2026-04-19T07:00:00+09:00',
        updatedAt: '2026-04-19T07:00:00+09:00',
      },
      {
        id: 'skill_walk_merged',
        mergedIntoSkillId: 'skill_walk_active',
        level: 1,
        totalXp: 0,
        status: 'merged',
        createdAt: '2026-04-19T07:00:00+09:00',
        updatedAt: '2026-04-19T07:00:00+09:00',
      } as never,
    ])
    vi.mocked(api.getSettings).mockResolvedValue(null)
    vi.mocked(api.getAiConfig).mockResolvedValue(null)
    vi.mocked(api.getMeta).mockResolvedValue(null)
    vi.mocked(api.getMessages).mockResolvedValue([])
    vi.mocked(api.getDictionary).mockResolvedValue([])

    const cloud = await loadFromCloud()

    expect(cloud).not.toBeNull()
    expect(cloud?.user.totalXp).toBe(8)
    expect(cloud?.skills.find((skill) => skill.id === 'skill_walk_merged')).toEqual(
      expect.objectContaining({
        id: 'skill_walk_merged',
        status: 'merged',
        mergedIntoSkillId: 'skill_walk_active',
        category: 'その他',
        source: 'manual',
      }),
    )
  })
})
