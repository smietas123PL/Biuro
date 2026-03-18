import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import AgentsPage from './pages/AgentsPage';
import TasksPage from './pages/TasksPage';
import ApprovalsPage from './pages/ApprovalsPage';
import AuditLogPage from './pages/AuditLogPage';
import AgentDetailPage from './pages/AgentDetailPage';
import TaskDetailPage from './pages/TaskDetailPage';

// Remaining Skeleton Pages
const DashboardPage = () => <div className="space-y-6">
  <h2 className="text-3xl font-bold">Overview</h2>
  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    <div className="p-6 bg-card border rounded-lg shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground">Active Agents</h3>
      <p className="text-2xl font-bold">12</p>
    </div>
    <div className="p-6 bg-card border rounded-lg shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground">Pending Tasks</h3>
      <p className="text-2xl font-bold">45</p>
    </div>
    <div className="p-6 bg-card border rounded-lg shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground">Daily Cost</h3>
      <p className="text-2xl font-bold">$12.42</p>
    </div>
  </div>
</div>;

const Placeholder = ({ title }: { title: string }) => <div className="space-y-6">
  <h2 className="text-3xl font-bold">{title}</h2>
  <div className="p-12 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-muted-foreground">
    <p>Loading {title} data...</p>
  </div>
</div>;

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="goals" element={<Placeholder title="Goals" />} />
        <Route path="tools" element={<Placeholder title="Tools" />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="audit" element={<AuditLogPage />} />
      </Route>
    </Routes>
  );
}

export default App;
