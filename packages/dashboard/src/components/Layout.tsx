import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  Target,
  Wrench,
  ShieldCheck,
  Activity,
  Settings,
  WalletCards,
  Search,
  Layers3,
  PlugZap,
  Network,
  Radar,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { useCompany } from '../context/CompanyContext';
import { useAuth } from '../context/AuthContext';
import { CommandPalette } from './CommandPalette';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Users, label: 'Agents', path: '/agents' },
  { icon: CheckSquare, label: 'Tasks', path: '/tasks' },
  { icon: Target, label: 'Goals', path: '/goals' },
  { icon: Network, label: 'Org Chart', path: '/org-chart' },
  { icon: WalletCards, label: 'Budgets', path: '/budgets' },
  { icon: Layers3, label: 'Templates', path: '/templates' },
  { icon: PlugZap, label: 'Integrations', path: '/integrations' },
  { icon: Wrench, label: 'Tools', path: '/tools' },
  { icon: Radar, label: 'Observability', path: '/observability' },
  { icon: ShieldCheck, label: 'Approvals', path: '/approvals' },
  { icon: Activity, label: 'Audit Log', path: '/audit' },
];

export function Layout() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId,
    createCompany,
    loading,
  } = useCompany();
  const { user, logout } = useAuth();
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyMission, setCompanyMission] = useState('');
  const [submittingCompany, setSubmittingCompany] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  const handleCreateCompany = async () => {
    if (!companyName.trim()) return;
    setSubmittingCompany(true);
    try {
      await createCompany({
        name: companyName.trim(),
        mission: companyMission.trim() || undefined,
      });
      setCompanyName('');
      setCompanyMission('');
      setShowCompanyForm(false);
    } finally {
      setSubmittingCompany(false);
    }
  };

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowCommandPalette(true);
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="text-primary w-6 h-6" />
            Biuro
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 w-full rounded-md transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Settings className="w-5 h-5" />
            <span className="font-medium">Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className="h-16 border-b flex items-center justify-between px-8 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>Company:</span>
            <select
              id="company-select"
              name="company"
              value={selectedCompanyId ?? ''}
              onChange={(event) => setSelectedCompanyId(event.target.value)}
              disabled={loading || companies.length === 0}
              className="min-w-56 rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            >
              {companies.length === 0 ? (
                <option value="">No companies yet</option>
              ) : (
                companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => setShowCompanyForm((current) => !current)}
              className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              New Company
            </button>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowCommandPalette(true)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Search className="h-4 w-4" />
              Search
              <span className="rounded border bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Ctrl K
              </span>
            </button>
            <div className="text-right">
              <div className="text-sm font-medium text-foreground">
                {user?.full_name || user?.email}
              </div>
              <div className="text-xs text-muted-foreground">
                Authenticated session
              </div>
            </div>
            <button
              onClick={() => void logout()}
              className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              Log out
            </button>
          </div>
        </header>

        <div className="p-8">
          {showCompanyForm && (
            <div className="mb-6 rounded-xl border bg-card p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-[1.2fr_2fr_auto]">
                <input
                  id="new-company-name"
                  name="companyName"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Company name"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                />
                <input
                  id="new-company-mission"
                  name="companyMission"
                  value={companyMission}
                  onChange={(event) => setCompanyMission(event.target.value)}
                  placeholder="Mission (optional)"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                />
                <button
                  onClick={handleCreateCompany}
                  disabled={submittingCompany || !companyName.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submittingCompany ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          )}

          {!selectedCompany && !loading && (
            <div className="mb-6 rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
              Create or choose a company to start working with agents and tasks.
            </div>
          )}

          <Outlet />
        </div>
      </main>
      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
      />
    </div>
  );
}
