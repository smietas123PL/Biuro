import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import AgentsPage from './pages/AgentsPage';
import TasksPage from './pages/TasksPage';
import ApprovalsPage from './pages/ApprovalsPage';
import AuditLogPage from './pages/AuditLogPage';
import AgentDetailPage from './pages/AgentDetailPage';
import TaskDetailPage from './pages/TaskDetailPage';
import DashboardPage from './pages/DashboardPage';
import GoalsPage from './pages/GoalsPage';
import BudgetsPage from './pages/BudgetsPage';
import TemplatesPage from './pages/TemplatesPage';
import ToolsPage from './pages/ToolsPage';
import AuthPage from './pages/AuthPage';
import SettingsPage from './pages/SettingsPage';
import IntegrationsPage from './pages/IntegrationsPage';
import OrgChartPage from './pages/OrgChartPage';
import ObservabilityPage from './pages/ObservabilityPage';
import { useAuth } from './context/AuthContext';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';

function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading session...</div>;
  }

  return (
    <>
      <NetworkStatusBanner />
      <Routes>
        <Route
          path="/auth"
          element={isAuthenticated ? <Navigate to="/" replace /> : <AuthPage />}
        />
        <Route
          path="/"
          element={isAuthenticated ? <Layout /> : <Navigate to="/auth" replace />}
        >
          <Route index element={<DashboardPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:id" element={<AgentDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="org-chart" element={<OrgChartPage />} />
          <Route path="budgets" element={<BudgetsPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="observability" element={<ObservabilityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="audit" element={<AuditLogPage />} />
        </Route>
        <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/auth'} replace />} />
      </Routes>
    </>
  );
}

export default App;
