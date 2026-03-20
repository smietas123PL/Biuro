import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './context/AuthContext';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';
import { ErrorBoundary } from './components/ErrorBoundary';

const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const AgentDetailPage = lazy(() => import('./pages/AgentDetailPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const GoalsPage = lazy(() => import('./pages/GoalsPage'));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage'));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const OrgChartPage = lazy(() => import('./pages/OrgChartPage'));
const ObservabilityPage = lazy(() => import('./pages/ObservabilityPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading view...
    </div>
  );
}

function RouteBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading session...
      </div>
    );
  }

  return (
    <>
      <NetworkStatusBanner />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            path="/auth"
            element={
              isAuthenticated ? <Navigate to="/" replace /> : <AuthPage />
            }
          />
          <Route
            path="/"
            element={
              isAuthenticated ? <Layout /> : <Navigate to="/auth" replace />
            }
          >
            <Route
              index
              element={
                <RouteBoundary>
                  <DashboardPage />
                </RouteBoundary>
              }
            />
            <Route
              path="agents"
              element={
                <RouteBoundary>
                  <AgentsPage />
                </RouteBoundary>
              }
            />
            <Route
              path="agents/:id"
              element={
                <RouteBoundary>
                  <AgentDetailPage />
                </RouteBoundary>
              }
            />
            <Route
              path="tasks"
              element={
                <RouteBoundary>
                  <TasksPage />
                </RouteBoundary>
              }
            />
            <Route
              path="tasks/:id"
              element={
                <RouteBoundary>
                  <TaskDetailPage />
                </RouteBoundary>
              }
            />
            <Route
              path="goals"
              element={
                <RouteBoundary>
                  <GoalsPage />
                </RouteBoundary>
              }
            />
            <Route
              path="org-chart"
              element={
                <RouteBoundary>
                  <OrgChartPage />
                </RouteBoundary>
              }
            />
            <Route
              path="budgets"
              element={
                <RouteBoundary>
                  <BudgetsPage />
                </RouteBoundary>
              }
            />
            <Route
              path="templates"
              element={
                <RouteBoundary>
                  <TemplatesPage />
                </RouteBoundary>
              }
            />
            <Route
              path="integrations"
              element={
                <RouteBoundary>
                  <IntegrationsPage />
                </RouteBoundary>
              }
            />
            <Route
              path="tools"
              element={
                <RouteBoundary>
                  <ToolsPage />
                </RouteBoundary>
              }
            />
            <Route
              path="observability"
              element={
                <RouteBoundary>
                  <ObservabilityPage />
                </RouteBoundary>
              }
            />
            <Route
              path="settings"
              element={
                <RouteBoundary>
                  <SettingsPage />
                </RouteBoundary>
              }
            />
            <Route
              path="approvals"
              element={
                <RouteBoundary>
                  <ApprovalsPage />
                </RouteBoundary>
              }
            />
            <Route
              path="audit"
              element={
                <RouteBoundary>
                  <AuditLogPage />
                </RouteBoundary>
              }
            />
          </Route>
          <Route
            path="*"
            element={<Navigate to={isAuthenticated ? '/' : '/auth'} replace />}
          />
        </Routes>
      </Suspense>
    </>
  );
}

export default App;
