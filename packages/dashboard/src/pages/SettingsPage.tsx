import { useCompany } from '../context/CompanyContext';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user } = useAuth();
  const { selectedCompany, selectedCompanyId, companies } = useCompany();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Current session and company context.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Session</h3>
          <div className="mt-4 space-y-3 text-sm">
            <Row label="User" value={user?.full_name || user?.email || 'Unknown'} />
            <Row label="Email" value={user?.email || 'Unknown'} />
            <Row label="Authenticated" value={user ? 'Yes' : 'No'} />
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Company Context</h3>
          <div className="mt-4 space-y-3 text-sm">
            <Row label="Selected company" value={selectedCompany?.name || 'None selected'} />
            <Row label="Company ID" value={selectedCompanyId || 'None selected'} />
            <Row label="Role" value={selectedCompany?.role || 'No role'} />
            <Row label="Available companies" value={`${companies.length}`} />
          </div>
        </section>
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">Health Checks</h3>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          <div>`/health` responds directly from the server root.</div>
          <div>`/api/health` remains available inside the API namespace.</div>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 px-4 py-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
