import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, GitBranchPlus, Network, UserRound, UsersRound } from 'lucide-react';
import { clsx } from 'clsx';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type AgentRecord = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  reports_to?: string | null;
  status: 'idle' | 'working' | 'paused' | 'terminated' | string;
};

type AgentNode = AgentRecord & {
  children: AgentNode[];
};

function buildAgentTree(agents: AgentRecord[]) {
  const nodeMap = new Map<string, AgentNode>();
  for (const agent of agents) {
    nodeMap.set(agent.id, { ...agent, children: [] });
  }

  const roots: AgentNode[] = [];
  for (const agent of agents) {
    const node = nodeMap.get(agent.id);
    if (!node) {
      continue;
    }

    if (agent.reports_to) {
      const manager = nodeMap.get(agent.reports_to);
      if (manager) {
        manager.children.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}

function countLeaves(nodes: AgentNode[]): number {
  return nodes.reduce((sum, node) => {
    if (node.children.length === 0) {
      return sum + 1;
    }
    return sum + countLeaves(node.children);
  }, 0);
}

function maxDepth(nodes: AgentNode[], depth = 0): number {
  if (nodes.length === 0) {
    return depth;
  }

  return Math.max(...nodes.map((node) => maxDepth(node.children, depth + 1)));
}

function getStatusTone(status: AgentRecord['status']) {
  if (status === 'working') return 'bg-sky-100 text-sky-700';
  if (status === 'paused') return 'bg-amber-100 text-amber-700';
  if (status === 'idle') return 'bg-emerald-100 text-emerald-700';
  return 'bg-slate-200 text-slate-700';
}

export default function OrgChartPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [agents, setAgents] = useState<AgentRecord[]>([]);

  useEffect(() => {
    const fetchOrgChart = async () => {
      if (!selectedCompanyId) {
        setAgents([]);
        return;
      }

      const data = (await request(`/companies/${selectedCompanyId}/org-chart`)) as AgentRecord[];
      setAgents(data);
    };

    void fetchOrgChart();
  }, [request, selectedCompanyId]);

  const agentTree = useMemo(() => buildAgentTree(agents), [agents]);
  const managerCount = useMemo(
    () => agents.filter((agent) => agents.some((candidate) => candidate.reports_to === agent.id)).length,
    [agents]
  );
  const contributorCount = useMemo(() => countLeaves(agentTree), [agentTree]);
  const depth = useMemo(() => Math.max(maxDepth(agentTree), 0), [agentTree]);

  if (!selectedCompany) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Choose a company to view its reporting structure.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/30 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            <Network className="h-3.5 w-3.5" />
            Organization View
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Org Chart</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Reporting structure for {selectedCompany.name}, built directly from each agent&apos;s
            <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">reports_to</code>
            relationship.
          </p>
        </div>

        <Link
          to="/agents"
          className="inline-flex items-center gap-2 rounded-md border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          <UsersRound className="h-4 w-4" />
          Manage Agents
        </Link>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<UserRound className="h-5 w-5 text-sky-700" />}
          label="Active seats"
          value={agents.length}
          helper="All non-terminated agents in the current company"
          tone="border-sky-200 bg-sky-50"
        />
        <StatCard
          icon={<Building2 className="h-5 w-5 text-emerald-700" />}
          label="Managers"
          value={managerCount}
          helper="Agents with at least one direct report"
          tone="border-emerald-200 bg-emerald-50"
        />
        <StatCard
          icon={<UsersRound className="h-5 w-5 text-amber-700" />}
          label="Individual contributors"
          value={contributorCount}
          helper="Leaf nodes in the current reporting tree"
          tone="border-amber-200 bg-amber-50"
        />
        <StatCard
          icon={<GitBranchPlus className="h-5 w-5 text-violet-700" />}
          label="Org depth"
          value={depth}
          helper="Longest chain from top-level lead to contributor"
          tone="border-violet-200 bg-violet-50"
        />
      </div>

      <section className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Reporting Map</h3>
            <p className="text-sm text-muted-foreground">
              Top-level leads sit on the first row and each branch expands beneath its manager.
            </p>
          </div>
          <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
            {loading ? 'Refreshing structure...' : `${agentTree.length} root ${agentTree.length === 1 ? 'leader' : 'leaders'}`}
          </div>
        </div>

        {agentTree.length > 0 ? (
          <div className="space-y-6">
            {agentTree.map((node) => (
              <OrgChartBranch key={node.id} node={node} depth={0} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No reporting lines yet. Assign managers in the Agents page to turn the team list into a real org chart.
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  helper: string;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tone}`}>
      <div className="mb-5 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {icon}
      </div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">{helper}</div>
    </div>
  );
}

function OrgChartBranch({ node, depth }: { node: AgentNode; depth: number }) {
  return (
    <div className="space-y-4">
      <div className="relative">
        {depth > 0 && (
          <div
            className="absolute left-5 top-[-18px] h-[18px] w-px bg-border"
            aria-hidden="true"
          />
        )}

        <div
          className="rounded-2xl border bg-background p-4 shadow-sm"
          style={{ marginLeft: `${depth * 28}px` }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/agents/${node.id}`} className="font-semibold text-foreground transition-colors hover:text-primary">
                  {node.name}
                </Link>
                <span className={clsx('rounded-full px-2 py-1 text-[11px] uppercase tracking-wide', getStatusTone(node.status))}>
                  {node.status}
                </span>
                {depth === 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                    top level
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">{node.title || node.role}</div>
            </div>

            <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
              {node.children.length} direct report{node.children.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="space-y-4">
          {node.children.map((child) => (
            <OrgChartBranch key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
