import { CustomerAuthGate } from '@/app/CustomerAuthGate'
import { OnboardingRoute } from '@/app/OnboardingRoute'
import { WorkbenchRoute } from '@/app/WorkbenchRoute'
import { getStoredWorkbenchRoute } from '@/layout/navigation'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Navigate replace to={getStoredWorkbenchRoute()} />} path="/" />
      <Route element={<OnboardingRoute />} path="/onboarding/:step" />
      <Route element={<WorkbenchRoute />} path="/*" />
      <Route element={<Navigate replace to={getStoredWorkbenchRoute()} />} path="*" />
    </Routes>
  )
}

export function App() {
  return (
    <HashRouter>
      <CustomerAuthGate>
        <AppRoutes />
      </CustomerAuthGate>
    </HashRouter>
  )
}
