import { useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const loginDefaults = {
  email: '',
  password: '',
};

const registerDefaults = {
  email: '',
  password: '',
  fullName: '',
  companyName: '',
  companyMission: '',
};

export default function AuthPage() {
  const navigate = useNavigate();
  const { login, register, loading, error } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginForm, setLoginForm] = useState(loginDefaults);
  const [registerForm, setRegisterForm] = useState(registerDefaults);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLocalError(null);
    try {
      await login(loginForm);
      navigate('/', { replace: true });
    } catch (err: any) {
      setLocalError(err.message);
    }
  };

  const handleRegister = async () => {
    setLocalError(null);
    try {
      await register({
        email: registerForm.email,
        password: registerForm.password,
        fullName: registerForm.fullName || undefined,
        companyName: registerForm.companyName,
        companyMission: registerForm.companyMission || undefined,
      });
      navigate('/', { replace: true });
    } catch (err: any) {
      setLocalError(err.message);
    }
  };

  const activeError = localError || error;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-10">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white/80 p-8 shadow-xl shadow-slate-200/60 backdrop-blur">
          <div className="flex items-center gap-3 text-slate-900">
            <div className="rounded-2xl bg-slate-900 p-3 text-white">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="text-lg font-semibold">Autonomiczne Biuro</div>
              <div className="text-sm text-slate-500">
                Secure control plane for your AI company
              </div>
            </div>
          </div>

          <div className="mt-12 space-y-6">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-slate-950">
                Sign in to run the company.
              </h1>
              <p className="mt-3 max-w-xl text-base text-slate-600">
                Log in to manage agents, budgets, approvals and tasks from one
                dashboard. New teams can create an owner account and their first
                company in one step.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FeatureCard
                title="Live operations"
                body="Watch agents, costs and approvals move in real time."
              />
              <FeatureCard
                title="Company isolation"
                body="Every request stays scoped to the companies you belong to."
              />
              <FeatureCard
                title="Safer runtime"
                body="Authenticated sessions and company-aware API headers are now required."
              />
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
          <div className="mb-6 flex gap-2 rounded-2xl bg-slate-100 p-1">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
            >
              Log in
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${mode === 'register' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
            >
              Create account
            </button>
          </div>

          {activeError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {activeError}
            </div>
          )}

          {mode === 'login' ? (
            <div className="space-y-4">
              <Field label="Email">
                <input
                  id="login-email"
                  name="email"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  type="email"
                  className="w-full rounded-xl border bg-white px-4 py-3 text-sm"
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Password">
                <input
                  id="login-password"
                  name="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  type="password"
                  className="w-full rounded-xl border bg-white px-4 py-3 text-sm"
                  placeholder="Minimum 8 characters"
                />
              </Field>
              <button
                onClick={() => void handleLogin()}
                disabled={loading || !loginForm.email || !loginForm.password}
                className="mt-2 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Logging in...' : 'Log in'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Full name">
                <input
                  id="register-full-name"
                  name="fullName"
                  value={registerForm.fullName}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      fullName: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border bg-white px-4 py-3 text-sm"
                  placeholder="Optional"
                />
              </Field>
              <Field label="Email">
                <input
                  id="register-email"
                  name="email"
                  value={registerForm.email}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  type="email"
                  className="w-full rounded-xl border bg-white px-4 py-3 text-sm"
                  placeholder="founder@example.com"
                />
              </Field>
              <Field label="Password">
                <input
                  id="register-password"
                  name="password"
                  value={registerForm.password}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  type="password"
                  className="w-full rounded-xl border bg-white px-4 py-3 text-sm"
                  placeholder="Minimum 8 characters"
                />
              </Field>
              <Field label="Company name">
                <input
                  id="register-company-name"
                  name="companyName"
                  value={registerForm.companyName}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      companyName: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border bg-white px-4 py-3 text-sm"
                  placeholder="Acme AI Labs"
                />
              </Field>
              <Field label="Mission">
                <textarea
                  id="register-company-mission"
                  name="companyMission"
                  value={registerForm.companyMission}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      companyMission: event.target.value,
                    }))
                  }
                  rows={4}
                  className="w-full rounded-xl border bg-white px-4 py-3 text-sm"
                  placeholder="Optional mission statement for the first company"
                />
              </Field>
              <button
                onClick={() => void handleRegister()}
                disabled={
                  loading ||
                  !registerForm.email ||
                  !registerForm.password ||
                  !registerForm.companyName
                }
                className="mt-2 w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Creating account...' : 'Create account'}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-2 text-sm text-slate-600">{body}</div>
    </div>
  );
}
