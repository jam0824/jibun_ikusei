export interface BrowsingTimeData {
  date: string
  domains: Record<string, { totalSeconds: number; category: string; isGrowth: boolean }>
  totalSeconds: number
}

export interface DomainAggregate {
  domain: string
  totalSeconds: number
  category: string
  isGrowth: boolean
}

export interface CategoryAggregate {
  category: string
  totalSeconds: number
  isGrowth: boolean
}

export function aggregateDomains(entries: BrowsingTimeData[], limit = 15): DomainAggregate[] {
  const map = new Map<string, DomainAggregate>()

  for (const entry of entries) {
    for (const [domain, data] of Object.entries(entry.domains)) {
      const existing = map.get(domain)
      if (existing) {
        existing.totalSeconds += data.totalSeconds
      } else {
        map.set(domain, {
          domain,
          totalSeconds: data.totalSeconds,
          category: data.category,
          isGrowth: data.isGrowth,
        })
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, limit)
}

export function aggregateByCategory(entries: BrowsingTimeData[]): CategoryAggregate[] {
  const map = new Map<string, CategoryAggregate>()

  for (const entry of entries) {
    for (const data of Object.values(entry.domains)) {
      const existing = map.get(data.category)
      if (existing) {
        existing.totalSeconds += data.totalSeconds
      } else {
        map.set(data.category, {
          category: data.category,
          totalSeconds: data.totalSeconds,
          isGrowth: data.isGrowth,
        })
      }
    }
  }

  return [...map.values()].sort((a, b) => b.totalSeconds - a.totalSeconds)
}
