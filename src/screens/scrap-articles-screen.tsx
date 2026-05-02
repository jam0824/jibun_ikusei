import { Archive, CheckCircle2, ExternalLink, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Screen, SectionHeader } from '@/components/layout'
import { Badge, Button, Card, CardContent, Input, Textarea } from '@/components/ui'
import type { ScrapArticle, ScrapArticleStatus } from '@/domain/types'
import { formatDateTime } from '@/lib/date'
import { useAppStore } from '@/store/app-store'

type ScrapFilter = 'all' | ScrapArticleStatus

const filterOptions: Array<{ key: ScrapFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'unread', label: '未読' },
  { key: 'read', label: '読了' },
  { key: 'archived', label: 'アーカイブ' },
]

function parseFilter(value: string | null): ScrapFilter {
  return value === 'unread' || value === 'read' || value === 'archived' ? value : 'all'
}

function getStatusBadge(scrap: ScrapArticle) {
  if (scrap.status === 'read') {
    return <Badge tone="success">読了</Badge>
  }
  if (scrap.status === 'archived') {
    return <Badge tone="outline">アーカイブ</Badge>
  }
  return <Badge tone="warning">未読</Badge>
}

export function ScrapArticlesScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const scraps = useAppStore((state) => state.scrapArticles)
  const shareMessage = useAppStore((state) => state.scrapShareMessage)
  const clearMessage = useAppStore((state) => state.clearScrapShareMessage)
  const setStatus = useAppStore((state) => state.setScrapArticleStatus)
  const deleteScrap = useAppStore((state) => state.deleteScrapArticle)
  const activeFilter = parseFilter(searchParams.get('filter'))

  const filteredScraps = useMemo(() => {
    const base = activeFilter === 'all' ? scraps : scraps.filter((scrap) => scrap.status === activeFilter)
    return [...base].sort((left, right) => {
      const leftValue = new Date(left.updatedAt ?? left.createdAt).getTime()
      const rightValue = new Date(right.updatedAt ?? right.createdAt).getTime()
      return rightValue - leftValue
    })
  }, [activeFilter, scraps])

  return (
    <Screen
      title="スクラップ記事"
      subtitle="あとで読みたい記事を貯めて、必要なときに開けます。"
      action={
        <div className="flex items-center gap-2">
          <Button size="icon" onClick={() => navigate('/records/scraps/new')} aria-label="記事を追加">
            <Plus className="h-5 w-5" />
          </Button>
          <Button size="icon" variant="secondary" onClick={() => navigate('/settings')} aria-label="設定">
            <Settings2 className="h-5 w-5" />
          </Button>
        </div>
      }
    >
      {shareMessage ? (
        <Card
          className={
            shareMessage.tone === 'danger'
              ? 'mb-4 border-rose-200 bg-rose-50'
              : shareMessage.tone === 'warning'
                ? 'mb-4 border-amber-200 bg-amber-50'
                : 'mb-4 border-emerald-200 bg-emerald-50'
          }
        >
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="text-sm font-semibold text-slate-800">{shareMessage.text}</div>
            <Button size="sm" variant="ghost" onClick={clearMessage}>
              閉じる
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section>
        <SectionHeader title="表示" />
        <div className="grid grid-cols-4 gap-2">
          {filterOptions.map((option) => {
            const isActive = option.key === activeFilter
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={isActive}
                className={`h-10 rounded-2xl border px-2 text-xs font-semibold transition ${
                  isActive
                    ? 'border-violet-300 bg-violet-50 text-violet-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
                onClick={() => setSearchParams(option.key === 'all' ? {} : { filter: option.key })}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </section>

      <section className="mt-4 space-y-3 pb-6">
        {filteredScraps.length === 0 ? (
          <EmptyState
            title="スクラップ記事はまだありません"
            description="Androidの共有メニュー、またはURL追加から記事を保存できます。"
            action={
              <Button onClick={() => navigate('/records/scraps/new')}>
                <Plus className="h-4 w-4" />
                URL追加
              </Button>
            }
          />
        ) : (
          filteredScraps.map((scrap) => (
            <Card key={scrap.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {getStatusBadge(scrap)}
                      <Badge tone="outline">{scrap.domain}</Badge>
                    </div>
                    <a
                      href={scrap.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 flex items-start gap-2 text-sm font-semibold text-slate-900 hover:text-violet-700"
                    >
                      <span className="min-w-0 flex-1 break-words">{scrap.title}</span>
                      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    </a>
                    <div className="mt-2 text-xs text-slate-500">
                      追加 {formatDateTime(scrap.createdAt)}
                    </div>
                    {scrap.memo ? (
                      <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        {scrap.memo}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {scrap.status === 'read' ? (
                    <Button size="sm" variant="outline" onClick={() => setStatus(scrap.id, 'unread')}>
                      <RotateCcw className="h-4 w-4" />
                      未読に戻す
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setStatus(scrap.id, 'read')}>
                      <CheckCircle2 className="h-4 w-4" />
                      読了
                    </Button>
                  )}
                  {scrap.status !== 'archived' ? (
                    <Button size="sm" variant="outline" onClick={() => setStatus(scrap.id, 'archived')}>
                      <Archive className="h-4 w-4" />
                      アーカイブ
                    </Button>
                  ) : null}
                  <Button size="sm" variant="danger" onClick={() => deleteScrap(scrap.id)}>
                    <Trash2 className="h-4 w-4" />
                    削除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </Screen>
  )
}

export function ScrapArticleFormScreen() {
  const navigate = useNavigate()
  const saveScrapArticle = useAppStore((state) => state.saveScrapArticle)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')

    const result = await saveScrapArticle({
      url,
      title,
      memo,
      addedFrom: 'manual',
    })
    setSaving(false)

    if (result.scrap) {
      navigate('/records/scraps')
      return
    }

    setError(result.reason ?? '保存できませんでした。')
  }

  return (
    <Screen
      title="URL追加"
      subtitle="あとで読みたい記事をスクラップに保存します。"
      action={
        <Button variant="secondary" onClick={() => navigate('/records/scraps')}>
          一覧
        </Button>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Card>
          <CardContent className="space-y-4 p-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">URL</span>
              <Input
                className="mt-2"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/article"
                inputMode="url"
                aria-label="URL"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">タイトル</span>
              <Input
                className="mt-2"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="空の場合はドメイン名を使います"
                aria-label="タイトル"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">メモ</span>
              <Textarea
                className="mt-2"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="あとで読みたい理由など"
                aria-label="メモ"
              />
            </label>
            {error ? <div className="text-sm font-semibold text-rose-600">{error}</div> : null}
          </CardContent>
        </Card>
        <Button type="submit" disabled={saving || !url.trim()}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </form>
    </Screen>
  )
}
