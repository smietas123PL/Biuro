import { Shield, Wrench } from 'lucide-react';
import { TraceLinkCallout } from '../TraceLinkCallout';
import type { ApiTraceSnapshot } from '../../hooks/useApi';

export function AgentSidebar({
  agent,
  budget,
  lastTrace,
}: {
  agent: any;
  budget: any;
  lastTrace: ApiTraceSnapshot | null;
}) {
  return (
    <div className="space-y-6">
      <div className="border rounded-xl bg-card p-6 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          Tool Capabilities
        </h3>
        <div className="flex flex-wrap gap-2">
          {agent.tools?.map((tool: any) => (
            <span key={tool.id} className="px-2 py-1 bg-accent rounded text-xs">
              {tool.name}
            </span>
          )) || (
            <p className="text-xs text-muted-foreground italic">
              No specialized tools
            </p>
          )}
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

      <TraceLinkCallout
        trace={lastTrace}
        title="Inspect Agent Trace"
        body="Jump into Grafana Explore for the latest agent detail or replay request."
      />
    </div>
  );
}
