import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { ClearEffectScreen } from '@/screens/clear-effect-screen'
import { GrowthScreen } from '@/screens/growth-screen'
import { HomeScreen } from '@/screens/home-screen'
import { BrowsingLogScreen, HealthLogScreen, NutritionLogScreen } from '@/screens/life-log-screens'
import { LilyChatScreen } from '@/screens/lily-chat-screen'
import { LoginScreen } from '@/screens/login-screen'
import { MealAnalyzeScreen } from '@/screens/meal-analyze-screen'
import { MealConfirmScreen } from '@/screens/meal-confirm-screen'
import { MealRegisterScreen } from '@/screens/meal-register-screen'
import { QuestFormScreen } from '@/screens/quest-form-screen'
import { QuestListScreen } from '@/screens/quest-list-screen'
import { RecordsHubScreen } from '@/screens/records-hub-screen'
import { RecordsScreen } from '@/screens/records-screen'
import { SettingsScreen } from '@/screens/settings-screen'
import { ScrapArticleFormScreen, ScrapArticlesScreen } from '@/screens/scrap-articles-screen'
import { WeeklyReflectionScreen } from '@/screens/weekly-reflection-screen'
import { ScrollToTopOnRouteChange } from '@/components/scroll-to-top-on-route-change'
import { ScrapShareToast } from '@/components/scrap-share-toast'
import { ActivityLogScreen } from '@/screens/activity-log-screen'
import { useAppStore } from '@/store/app-store'
import { isLoggedIn } from '@/lib/auth'
import {
  consumeShareLandingResetFlag,
  extractShareParamsFromSearch,
  markShareLandingForNextLaunchReset,
  readPendingScrapShare,
  writePendingScrapShare,
} from '@/lib/scrap-article'

// [DEBUG] 共有調査用: モジュール読み込み時点(Reactがいじる前)の起動URLを捕捉する
const LAUNCH_HREF = typeof window !== 'undefined' ? window.location.href : ''

// [DEBUG] 共有調査用バナー。原因確定後に削除する。
function DebugShareBanner() {
  const [launchTargetUrl, setLaunchTargetUrl] = useState<string>('(未受信)')
  const [pending, setPending] = useState<string>('(空)')

  useEffect(() => {
    const lq = (
      window as unknown as {
        launchQueue?: { setConsumer: (cb: (p: { targetURL?: string }) => void) => void }
      }
    ).launchQueue
    if (lq?.setConsumer) {
      try {
        lq.setConsumer((params) => {
          if (params?.targetURL) {
            setLaunchTargetUrl(params.targetURL)
          }
        })
      } catch {
        setLaunchTargetUrl('(setConsumer失敗)')
      }
    } else {
      setLaunchTargetUrl('(launchQueue非対応)')
    }
  }, [])

  useEffect(() => {
    const update = () => {
      setPending(window.sessionStorage.getItem('scrap.pendingShare') ?? '(空)')
    }
    update()
    const id = window.setInterval(update, 500)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999999,
        background: 'rgba(0,0,0,0.88)',
        color: '#34d399',
        font: '11px/1.5 monospace',
        padding: '8px 10px',
        maxHeight: '45vh',
        overflow: 'auto',
        wordBreak: 'break-all',
      }}
    >
      <div style={{ color: '#fbbf24', fontWeight: 'bold' }}>[DEBUG] 共有調査用(あとで消します)</div>
      <div>LAUNCH_HREF: {LAUNCH_HREF}</div>
      <div>launchQueue.targetURL: {launchTargetUrl}</div>
      <div>pendingShare: {pending}</div>
    </div>
  )
}

function normalizeLoginReturnTarget(target: string | null | undefined): string {
  if (!target) {
    return '/'
  }

  const raw = target.startsWith('#') ? target.slice(1) : target
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) {
    return '/'
  }
  return raw
}

function buildLoginHash(hashValue: string): string {
  const raw = hashValue.startsWith('#') ? hashValue.slice(1) : hashValue
  if (raw.startsWith('/login')) {
    return hashValue || '#/login'
  }

  const returnTo = encodeURIComponent(normalizeLoginReturnTarget(raw))
  return `#/login?returnTo=${returnTo}`
}

function resolveLoginReturnTarget(hashValue: string): string {
  const raw = hashValue.startsWith('#') ? hashValue.slice(1) : hashValue
  if (!raw.startsWith('/login')) {
    return normalizeLoginReturnTarget(raw)
  }

  const [, query = ''] = raw.split('?')
  const returnTo = new URLSearchParams(query).get('returnTo')
  return normalizeLoginReturnTarget(returnTo)
}

function isScrapLandingRoute() {
  const rawHash = window.location.hash || '#/'
  const hashPath = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  return hashPath === '/records/scraps' || hashPath.startsWith('/records/scraps?')
}

function resetStaleScrapLandingRoute() {
  if (extractShareParamsFromSearch(window.location.search)) {
    return
  }

  const shouldResetShareLanding = isScrapLandingRoute() && !readPendingScrapShare()
  consumeShareLandingResetFlag()
  if (shouldResetShareLanding) {
    window.history.replaceState(null, '', `${window.location.pathname}#/`)
    window.location.hash = '#/'
  }
}

function LegacyGrowthRecordsRedirect() {
  const location = useLocation()
  const target = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const legacyRange = params.get('range') ?? params.get('filter')

    if (legacyRange === 'today' || legacyRange === 'week' || legacyRange === 'all') {
      return `/records/growth?range=${legacyRange}`
    }

    return '/records/growth'
  }, [location.search])

  return <Navigate to={target} replace />
}

function LegacyLifeBrowsingRedirect() {
  const location = useLocation()
  const target = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const next = new URLSearchParams()
    const period = params.get('period')
    const date = params.get('date')

    if (period === 'day' || period === 'week' || period === 'month' || period === 'all') {
      next.set('period', period)
    }

    if (date) {
      next.set('date', date)
    }

    if (!next.has('period')) {
      next.set('period', 'day')
    }

    return `/records/life/browsing?${next.toString()}`
  }, [location.search])

  return <Navigate to={target} replace />
}

export function AppShellRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/quests" element={<QuestListScreen />} />
      <Route path="/quests/new" element={<QuestFormScreen />} />
      <Route path="/growth" element={<GrowthScreen />} />
      <Route path="/records" element={<Outlet />}>
        <Route index element={<RecordsHubScreen />} />
        <Route path="growth" element={<RecordsScreen />} />
        <Route path="activity/today" element={<ActivityLogScreen variant="today" />} />
        <Route path="activity/day/:dateKey" element={<ActivityLogScreen variant="day" />} />
        <Route path="activity/calendar" element={<ActivityLogScreen variant="calendar" />} />
        <Route path="activity/search" element={<ActivityLogScreen variant="search" />} />
        <Route path="activity/browsing" element={<LegacyLifeBrowsingRedirect />} />
        <Route path="activity/review/year" element={<ActivityLogScreen variant="review-year" />} />
        <Route path="activity/review/week" element={<ActivityLogScreen variant="review-week" />} />
        <Route path="life/nutrition" element={<NutritionLogScreen />} />
        <Route path="life/health" element={<HealthLogScreen />} />
        <Route path="life/browsing" element={<BrowsingLogScreen />} />
        <Route path="review/weekly" element={<WeeklyReflectionScreen />} />
        <Route path="scraps" element={<ScrapArticlesScreen />} />
        <Route path="scraps/new" element={<ScrapArticleFormScreen />} />
      </Route>
      <Route path="/status" element={<Navigate to="/growth" replace />} />
      <Route path="/skills" element={<Navigate to="/growth" replace />} />
      <Route path="/weekly-reflection" element={<Navigate to="/records/review/weekly" replace />} />
      <Route path="/records/quests" element={<LegacyGrowthRecordsRedirect />} />
      <Route path="/lily" element={<LilyChatScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="/clear/:completionId" element={<ClearEffectScreen />} />
      <Route path="/meal" element={<MealRegisterScreen />} />
      <Route path="/meal/analyze" element={<MealAnalyzeScreen />} />
      <Route path="/meal/confirm" element={<MealConfirmScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function AppRoutes() {
  const initialize = useAppStore((state) => state.initialize)
  const consumePendingScrapShare = useAppStore((state) => state.consumePendingScrapShare)
  const [authChecked, setAuthChecked] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  useLayoutEffect(() => {
    resetStaleScrapLandingRoute()
  }, [])

  useEffect(() => {
    const sharePayload = extractShareParamsFromSearch(window.location.search)
    if (!sharePayload) {
      return
    }

    writePendingScrapShare(sharePayload)
    markShareLandingForNextLaunchReset()
    window.history.replaceState(null, '', `${window.location.pathname}#/`)
    window.location.hash = '#/'
  }, [])

  useEffect(() => {
    isLoggedIn().then((result) => {
      setLoggedIn(result)
      setAuthChecked(true)
      if (result) initialize()
    })
  }, [initialize])

  useEffect(() => {
    if (!authChecked || loggedIn) {
      return
    }

    const loginHash = buildLoginHash(window.location.hash)
    if (window.location.hash !== loginHash) {
      window.location.hash = loginHash
    }
  }, [authChecked, loggedIn])

  useEffect(() => {
    if (!authChecked || !loggedIn || typeof consumePendingScrapShare !== 'function') {
      return
    }

    if (!readPendingScrapShare()) {
      return
    }

    void consumePendingScrapShare().then(() => {
      if (window.location.hash !== '#/') {
        window.location.hash = '#/'
      }
    })
  }, [authChecked, consumePendingScrapShare, loggedIn])

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-violet-400 text-sm">読み込み中...</div>
      </div>
    )
  }

  if (!loggedIn) {
    return (
      <LoginScreen
        onLogin={() => {
          const targetPath = resolveLoginReturnTarget(window.location.hash)
          setLoggedIn(true)
          initialize()
          window.location.hash = `#${targetPath}`
        }}
      />
    )
  }

  return (
    <>
      <AppShellRoutes />
      <ScrapShareToast />
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <ScrollToTopOnRouteChange />
      <AppRoutes />
      <DebugShareBanner />
    </HashRouter>
  )
}
