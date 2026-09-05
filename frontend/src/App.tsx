import { Navigate, Route, BrowserRouter as Router, Routes, useParams } from 'react-router-dom'

import { Layout } from './components/Layout'
import { Loading } from './components/ui'
import { AuthProvider, useAuth } from './lib/hooks'
import { LeagueProvider } from './lib/league'
import { AdminDashboard, AdminLogin, AdminSetup } from './pages/Admin'
import { ForgotPassword, ResetPassword } from './pages/PasswordReset'
import { AdminAuction } from './pages/AdminAuction'
import { Contact } from './pages/Content'
import { LeagueDetail } from './pages/LeagueDetail'
import { Home } from './pages/Home'
import { Leagues } from './pages/Leagues'
import { Live } from './pages/Live'
import { ChoosePlayerLeague, PlayerProfile, Players } from './pages/Players'
import { Register } from './pages/Register'
import { TeamDetail } from './pages/Teams'

/** /history/12 was the old address for what is now /leagues/12. */
function LegacyHistoryRedirect() {
  const { leagueId } = useParams()
  return <Navigate to={`/leagues/${leagueId}`} replace />
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { email, ready } = useAuth()
  if (!ready) return <Loading label="Checking your session" />
  return email ? children : <Navigate to="/admin/login" replace />
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <LeagueProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="leagues" element={<Leagues />} />
              <Route path="leagues/:leagueId" element={<LeagueDetail />} />
              {/* Squads live inside their league; a squad still has its own
                  page, reached from there. */}
              <Route path="teams" element={<Navigate to="/leagues" replace />} />
              <Route path="teams/:teamId" element={<TeamDetail />} />
              {/* Players belong to a league, so the list lives under one.
                  A bare /players offers the choice. */}
              {/* The register is for organisers. The public sees players
                  through a league's result and its squads. */}
              <Route
                path="players"
                element={
                  <RequireAdmin>
                    <ChoosePlayerLeague />
                  </RequireAdmin>
                }
              />
              <Route
                path="leagues/:leagueId/players"
                element={
                  <RequireAdmin>
                    <Players />
                  </RequireAdmin>
                }
              />
              <Route
                path="players/:playerId"
                element={
                  <RequireAdmin>
                    <PlayerProfile />
                  </RequireAdmin>
                }
              />
              <Route path="live" element={<Live />} />
              <Route path="register" element={<Register />} />
              <Route path="register/:leagueId" element={<Register />} />
              {/* Old links keep working. */}
              <Route path="history" element={<Navigate to="/leagues" replace />} />
              <Route path="history/:leagueId" element={<LegacyHistoryRedirect />} />
              <Route path="contact" element={<Contact />} />

              <Route path="admin/login" element={<AdminLogin />} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="reset-password" element={<ResetPassword />} />
              <Route
                path="admin"
                element={
                  <RequireAdmin>
                    <AdminDashboard />
                  </RequireAdmin>
                }
              />
              <Route
                path="admin/setup"
                element={
                  <RequireAdmin>
                    <AdminSetup />
                  </RequireAdmin>
                }
              />
              <Route
                path="admin/auction"
                element={
                  <RequireAdmin>
                    <AdminAuction />
                  </RequireAdmin>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </LeagueProvider>
      </AuthProvider>
    </Router>
  )
}
