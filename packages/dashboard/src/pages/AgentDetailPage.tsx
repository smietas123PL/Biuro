import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Bot, Activity, Wrench, Shield } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';

type AuditLogResponse = {
  items: any[];
  has_more: boolean;
  next_cursor: { created_at: string; id: string } | null;
};

export default function AgentDetailPage() {
  const { id } = useParams();
  const { request } = useApi();
  const { selectedCompanyId } = useCompany();
  const [agent, setAgent] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [budget, setBudget] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      const data = await request(`/agents/${id}`);
      setAgent(data);
      const [logData, budgetData, heartbeatData] = await Promise.all([
        selectedCompanyId
          ? (request(`/companies/${selectedCompanyId}/audit-log?limit=100`) as Promise<AuditLogResponse>)
          : Promise.resolve({ items: [], has_more: false, next_cursor: null } satisfies AuditLogResponse),
        request(`/agents/${id}/budgets`),
        request(`/agents/${id}/heartbeats`),
      ]);
      setLogs([
        ...logData.items.filter((log: any) => log.agent_id === id),
        ...heartbeatData.map((heartbeat: any) => ({
          id: `${heartbeat.timestamp}-${heartbeat.status}`,
          action: `heartbeat.${heartbeat.status}`,
          created_at: heartbeat.timestamp,
          details: heartbeat.details,
        })),
      ]);
      setBudget(Array.isArray(budgetData) ? budgetData[0] ?? null : budgetData);
    };
    void fetchData();
  }, [id, selectedCompanyId]);

  if (!agent) return <div className="p-8">Loading...</div>;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Bot className="w-8 h-8 text-primary" />
            <h2 className="text-3xl font-bold tracking-tight">{agent.name}</h2>
            <span className={`px-2 py-1 rounded-md text-xs font-medium ${
              agent.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
            }`}>
              {agent.status.toUpperCase()}
            </span>
          </div>
          <p className="text-muted-foreground">{agent.role}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
           <div className="border rounded-xl bg-card p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Recent Activity
              </h3>
              <div className="space-y-4">
                {logs.map((log) => (
                  <div key={log.id} className="border-l-2 border-primary/20 pl-4 py-1 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{log.action}</span>
                      <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-sm">{log.details?.thought || 'System operation'}</p>
                  </div>
                ))}
              </div>
           </div>
        </div>

        <div className="space-y-6">
           <div className="border rounded-xl bg-card p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Wrench className="w-4 h-4 text-primary" />
                Tool Capabilities
              </h3>
              <div className="flex flex-wrap gap-2">
                {agent.tools?.map((t: any) => (
                  <span key={t.id} className="px-2 py-1 bg-accent rounded text-xs">
                    {t.name}
                  </span>
                )) || <p className="text-xs text-muted-foreground italic">No specialized tools</p>}
              </div>
           </div>

           <div className="border rounded-xl bg-card p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                Governance
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Budget Limit</span>
                  <span>${budget?.limit_usd || agent.monthly_budget_usd || '0.00'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Spent This Month</span>
                  <span>${budget?.spent_usd || '0.00'}</span>
                </div>
                <div className="flex justify-between">
                   <span className="text-muted-foreground">Runtime</span>
                   <span>{agent.runtime}</span>
                </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
