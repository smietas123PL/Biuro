import { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, GitBranchPlus } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type Goal = {
  id: string;
  parent_id?: string | null;
  title: string;
  description?: string | null;
  status: 'active' | 'achieved' | 'abandoned';
};

export default function GoalsPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    const fetchGoals = async () => {
      if (!selectedCompanyId) {
        setGoals([]);
        return;
      }

      const data = await request(`/companies/${selectedCompanyId}/goals`);
      setGoals(data);
    };

    void fetchGoals();
  }, [request, selectedCompanyId]);

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to inspect goals.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Goals</h2>
        <p className="text-sm text-muted-foreground">Mission structure for {selectedCompany.name}</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <div className="text-sm text-muted-foreground">
            {loading ? 'Loading goals...' : `${goals.length} goal${goals.length === 1 ? '' : 's'} loaded`}
          </div>
        </div>

        <div className="divide-y">
          {goals.map((goal) => (
            <div key={goal.id} className="flex gap-4 px-6 py-5">
              <div className="mt-1">
                {goal.status === 'achieved' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <CircleDashed className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold">{goal.title}</div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {goal.status}
                  </span>
                  {goal.parent_id && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-xs text-sky-700">
                      <GitBranchPlus className="h-3.5 w-3.5" />
                      Child goal
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{goal.description || 'No description provided.'}</p>
              </div>
            </div>
          ))}

          {goals.length === 0 && !loading && (
            <div className="p-12 text-center text-muted-foreground italic">
              No goals defined yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
