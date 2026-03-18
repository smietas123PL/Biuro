import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { History } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';

export default function AuditLogPage() {
  const { request, loading } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchLogs = async () => {
      if (!selectedCompanyId) {
        setLogs([]);
        return;
      }

      const data = await request(`/companies/${selectedCompanyId}/audit-log`);
      setLogs(data);
    };
    void fetchLogs();
  }, [selectedCompanyId]);

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to inspect the audit log.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Audit Log</h2>
        <p className="text-sm text-muted-foreground">Recent events for {selectedCompany.name}</p>
      </div>
      
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="divide-y">
          {logs.map((log) => (
            <div key={log.id} className="p-4 flex gap-4 hover:bg-accent/30 transition-colors">
              <div className="mt-1">
                <History className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between items-start">
                  <div className="font-semibold text-sm">{log.action}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  Agent: <span className="text-foreground">{log.agent_id?.split('-')[0] || 'System'}</span>
                </div>
                {log.details && (
                  <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-24">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
          {logs.length === 0 && !loading && (
            <div className="p-12 text-center text-muted-foreground italic">
               No events logged yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
