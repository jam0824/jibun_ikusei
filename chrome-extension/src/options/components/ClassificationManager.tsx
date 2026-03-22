import { useEffect, useMemo, useState } from 'react'
import type { BrowsingCategory, ClassificationCacheEntry } from '@ext/types/browsing'
import { isGrowthCategory } from '@ext/types/browsing'

const ALL_CATEGORIES: BrowsingCategory[] = ['学習', '仕事', '健康', '生活', '創作', '対人', '娯楽', 'その他']
const PAGE_SIZE = 20

type CacheStore = Record<string, ClassificationCacheEntry>

export function ClassificationManager() {
  const [cache, setCache] = useState<CacheStore>({})
  const [edits, setEdits] = useState<Record<string, BrowsingCategory>>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    chrome.storage.local.get('classificationCache').then((result) => {
      setCache((result.classificationCache as CacheStore) ?? {})
    })
  }, [])

  const filteredEntries = useMemo(() => {
    const all = Object.entries(cache)
    if (!search) return all
    const lower = search.toLowerCase()
    return all.filter(([key]) => key.toLowerCase().includes(lower))
  }, [cache, search])

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE))
  const pagedEntries = filteredEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  if (Object.keys(cache).length === 0) {
    return <div style={{ fontSize: 13, color: '#999' }}>分類データがまだありません</div>
  }

  const handleCategoryChange = (cacheKey: string, category: BrowsingCategory) => {
    setEdits((prev) => ({ ...prev, [cacheKey]: category }))
  }

  const handleSave = async (cacheKey: string) => {
    const newCategory = edits[cacheKey]
    if (!newCategory) return

    const entry = cache[cacheKey]
    if (!entry) return

    const updatedEntry: ClassificationCacheEntry = {
      ...entry,
      result: {
        ...entry.result,
        category: newCategory,
        isGrowth: isGrowthCategory(newCategory),
      },
      source: 'manual',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }

    const newCache = { ...cache, [cacheKey]: updatedEntry }
    setCache(newCache)
    setEdits((prev) => {
      const next = { ...prev }
      delete next[cacheKey]
      return next
    })

    await chrome.storage.local.set({ classificationCache: newCache })
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <input
          type="text"
          placeholder="ドメインで検索…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{ fontSize: 13, padding: '4px 8px', width: 240 }}
        />
      </div>

      {filteredEntries.length === 0 ? (
        <div style={{ fontSize: 13, color: '#999' }}>該当する分類データがありません</div>
      ) : (
        <>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>キー</th>
                <th style={{ padding: '4px 8px' }}>カテゴリ</th>
                <th style={{ padding: '4px 8px' }}>ソース</th>
                <th style={{ padding: '4px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {pagedEntries.map(([key, entry]) => {
                const currentCategory = edits[key] ?? entry.result.category
                const isEdited = key in edits
                return (
                  <tr key={key} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '4px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {key}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <select
                        value={currentCategory}
                        onChange={(e) => handleCategoryChange(key, e.target.value as BrowsingCategory)}
                        style={{ fontSize: 13 }}
                      >
                        {ALL_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '4px 8px', color: entry.source === 'manual' ? '#00897b' : '#999' }}>
                      {entry.source === 'manual' ? '手動' : 'AI'}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      {isEdited && (
                        <button
                          onClick={() => handleSave(key)}
                          style={{
                            fontSize: 12,
                            padding: '2px 8px',
                            background: '#00897b',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        >
                          保存
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <button onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                前へ
              </button>
              <span>{page + 1} / {totalPages} ページ</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}>
                次へ
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
