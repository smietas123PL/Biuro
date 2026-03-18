import { useEffect, useState } from 'react';
import { Bot, Globe, Hammer, Package2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type Tool = {
  id: string;
  name: string;
  description?: string | null;
  type: 'builtin' | 'http' | 'bash' | 'mcp';
  agent_count: number;
};

const typeIcon = {
  builtin: Bot,
  http: Globe,
  bash: Hammer,
  mcp: Package2,
} as const;

export default function ToolsPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [tools, setTools] = useState<Tool[]>([]);

  useEffect(() => {
    const fetchTools = async () => {
      if (!selectedCompanyId) {
        setTools([]);
        return;
      }

      const data = await request(`/companies/${selectedCompanyId}/tools`);
      setTools(data);
    };

    void fetchTools();
  }, [request, selectedCompanyId]);

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to review tools.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Tools</h2>
        <p className="text-sm text-muted-foreground">Executable capabilities assigned inside {selectedCompany.name}</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => {
          const Icon = typeIcon[tool.type] ?? Package2;

          return (
            <div key={tool.id} className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{tool.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{tool.description || 'No description provided.'}</div>
                </div>
                <div className="rounded-xl bg-muted p-3 text-muted-foreground">
                  <Icon className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between text-sm">
                <span className="rounded-full bg-muted px-2 py-1 uppercase tracking-wide text-muted-foreground">
                  {tool.type}
                </span>
                <span className="text-muted-foreground">{tool.agent_count} assigned agents</span>
              </div>
            </div>
          );
        })}

        {tools.length === 0 && !loading && (
          <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-muted-foreground italic">
            No tools registered yet.
          </div>
        )}
      </div>
    </div>
  );
}
