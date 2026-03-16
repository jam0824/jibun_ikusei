import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ClearEffectScreen } from '@/screens/clear-effect-screen'
import { HomeScreen } from '@/screens/home-screen'
import { QuestFormScreen } from '@/screens/quest-form-screen'
import { QuestListScreen } from '@/screens/quest-list-screen'
import { RecordsScreen } from '@/screens/records-screen'
import { SettingsScreen } from '@/screens/settings-screen'
import { SkillsScreen } from '@/screens/skills-screen'
import { useAppStore } from '@/store/app-store'

function AppRoutes() {
  const initialize = useAppStore((state) => state.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/quests" element={<QuestListScreen />} />
      <Route path="/quests/new" element={<QuestFormScreen />} />
      <Route path="/skills" element={<SkillsScreen />} />
      <Route path="/records" element={<RecordsScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="/clear/:completionId" element={<ClearEffectScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}
