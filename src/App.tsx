import { useEffect, useMemo, useState } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { ClearEffectScreen } from '@/screens/clear-effect-screen'
import { HomeScreen } from '@/screens/home-screen'
import { LilyChatScreen } from '@/screens/lily-chat-screen'
import { LoginScreen } from '@/screens/login-screen'
import { MealAnalyzeScreen } from '@/screens/meal-analyze-screen'
import { MealConfirmScreen } from '@/screens/meal-confirm-screen'
import { MealRegisterScreen } from '@/screens/meal-register-screen'
import { QuestFormScreen } from '@/screens/quest-form-screen'
import { QuestListScreen } from '@/screens/quest-list-screen'
import { RecordsScreen } from '@/screens/records-screen'
import { SettingsScreen } from '@/screens/settings-screen'
import { SkillsScreen } from '@/screens/skills-screen'
import { StatusScreen } from '@/screens/status-screen'
import { WeeklyReflectionScreen } from '@/screens/weekly-reflection-screen'
import { ScrollToTopOnRouteChange } from '@/components/scroll-to-top-on-route-change'
import { ActivityLogScreen } from '@/screens/activity-log-screen'
import { getDefaultRecordsRoute, readLastRecordsRoute } from '@/lib/records-route-state'
import { useAppStore } from '@/store/app-store'
import { isLoggedIn } from '@/lib/auth'

function RecordsRouteHub() {
  const location = useLocation()
  const target = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const legacyRange = params.get('range') ?? params.get('filter')

    if (legacyRange === 'today' || legacyRange === 'week' || legacyRange === 'all') {
      return `/records/quests?range=${legacyRange}`
    }

    return readLastRecordsRoute() || getDefaultRecordsRoute()
  }, [location.search])

  return <Navigate to={target} replace />
}

export function AppShellRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/status" element={<StatusScreen />} />
      <Route path="/quests" element={<QuestListScreen />} />
      <Route path="/quests/new" element={<QuestFormScreen />} />
      <Route path="/skills" element={<SkillsScreen />} />
      <Route path="/records" element={<Outlet />}>
        <Route index element={<RecordsRouteHub />} />
        <Route path="quests" element={<RecordsScreen />} />
        <Route path="activity/today" element={<ActivityLogScreen variant="today" />} />
        <Route path="activity/day/:dateKey" element={<ActivityLogScreen variant="day" />} />
        <Route path="activity/calendar" element={<ActivityLogScreen variant="calendar" />} />
        <Route path="activity/search" element={<ActivityLogScreen variant="search" />} />
        <Route path="activity/review/year" element={<ActivityLogScreen variant="review-year" />} />
        <Route path="activity/review/week" element={<ActivityLogScreen variant="review-week" />} />
      </Route>
      <Route path="/weekly-reflection" element={<WeeklyReflectionScreen />} />
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
  const [authChecked, setAuthChecked] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    isLoggedIn().then((result) => {
      setLoggedIn(result)
      setAuthChecked(true)
      if (result) initialize()
    })
  }, [initialize])

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
          setLoggedIn(true)
          initialize()
        }}
      />
    )
  }

  return <AppShellRoutes />
}

export default function App() {
  return (
    <HashRouter>
      <ScrollToTopOnRouteChange />
      <AppRoutes />
    </HashRouter>
  )
}
