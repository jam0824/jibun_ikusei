import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import { ActivityLogMockScreen } from '@/screens/activity-log-mock-screen'
import { useAppStore } from '@/store/app-store'
import { isLoggedIn } from '@/lib/auth'

export function AppShellRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/status" element={<StatusScreen />} />
      <Route path="/quests" element={<QuestListScreen />} />
      <Route path="/quests/new" element={<QuestFormScreen />} />
      <Route path="/skills" element={<SkillsScreen />} />
      <Route path="/records" element={<RecordsScreen />} />
      <Route path="/records/activity/today" element={<ActivityLogMockScreen variant="today" />} />
      <Route path="/records/activity/day/:dateKey" element={<ActivityLogMockScreen variant="day" />} />
      <Route path="/records/activity/calendar" element={<ActivityLogMockScreen variant="calendar" />} />
      <Route path="/records/activity/search" element={<ActivityLogMockScreen variant="search" />} />
      <Route path="/records/activity/review/year" element={<ActivityLogMockScreen variant="review-year" />} />
      <Route path="/records/activity/review/week" element={<ActivityLogMockScreen variant="review-week" />} />
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
