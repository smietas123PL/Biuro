import { useEffect, useState } from 'react';
import type {
  CompanyDigestSettingsResponse,
  CompanyRuntimeSettingsResponse,
  RuntimeName,
} from '@biuro/shared';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { useCompany } from '../context/CompanyContext';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../context/OnboardingContext';
import { useApi } from '../hooks/useApi';

function runtimeTone(runtime: RuntimeName) {
  if (runtime === 'gemini') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (runtime === 'claude')
    return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-green-100 text-green-700 border-green-200';
}

function runtimeLabel(runtime: RuntimeName) {
  if (runtime === 'gemini') return 'Gemini';
  if (runtime === 'claude') return 'Claude';
  return 'OpenAI';
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { selectedCompany, selectedCompanyId, companies } = useCompany();
  const { request, loading, error } = useApi();
  const { hasCompleted, startTutorial } = useOnboarding();
  const [runtimeSettings, setRuntimeSettings] =
    useState<CompanyRuntimeSettingsResponse | null>(null);
  const [digestSettings, setDigestSettings] =
    useState<CompanyDigestSettingsResponse | null>(null);
  const [draftPrimary, setDraftPrimary] = useState<RuntimeName>('gemini');
  const [draftFallback, setDraftFallback] = useState<RuntimeName[]>([
    'gemini',
    'claude',
    'openai',
  ]);
  const [draftDigestEnabled, setDraftDigestEnabled] = useState(true);
  const [draftDigestHour, setDraftDigestHour] = useState(18);
  const [draftDigestMinute, setDraftDigestMinute] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingDigest, setSavingDigest] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [digestSaveMessage, setDigestSaveMessage] = useState<string | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimeSettings() {
      if (!selectedCompanyId) {
        setRuntimeSettings(null);
        setSaveMessage(null);
        return;
      }

      try {
        const data = (await request(
          `/companies/${selectedCompanyId}/runtime-settings`,
          undefined,
          { suppressError: true }
        )) as CompanyRuntimeSettingsResponse;
        if (cancelled) {
          return;
        }
        setRuntimeSettings(data);
        setDraftPrimary(data.primary_runtime);
        setDraftFallback(data.fallback_order);
      } catch {
        if (!cancelled) {
          setRuntimeSettings(null);
        }
      }
    }

    void loadRuntimeSettings();
    return () => {
      cancelled = true;
    };
  }, [request, selectedCompanyId]);

  useEffect(() => {
    let cancelled = false;

    async function loadDigestSettings() {
      if (!selectedCompanyId) {
        setDigestSettings(null);
        setDigestSaveMessage(null);
        return;
      }

      try {
        const data = (await request(
          `/companies/${selectedCompanyId}/digest-settings`,
          undefined,
          { suppressError: true }
        )) as CompanyDigestSettingsResponse;
        if (cancelled) {
          return;
        }
        setDigestSettings(data);
        setDraftDigestEnabled(data.enabled);
        setDraftDigestHour(data.hour_utc);
        setDraftDigestMinute(data.minute_utc);
      } catch {
        if (!cancelled) {
          setDigestSettings(null);
        }
      }
    }

    void loadDigestSettings();
    return () => {
      cancelled = true;
    };
  }, [request, selectedCompanyId]);

  const moveRuntime = (runtime: RuntimeName, direction: 'up' | 'down') => {
    setDraftFallback((current) => {
      const index = current.indexOf(runtime);
      if (index === -1) {
        return current;
      }

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
      return next;
    });
  };

  const handleReset = () => {
    if (!runtimeSettings) {
      return;
    }

    setDraftPrimary(runtimeSettings.system_defaults.primary_runtime);
    setDraftFallback(runtimeSettings.system_defaults.fallback_order);
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!selectedCompanyId) {
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    try {
      const data = (await request(
        `/companies/${selectedCompanyId}/runtime-settings`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            primary_runtime: draftPrimary,
            fallback_order: draftFallback,
          }),
        }
      )) as CompanyRuntimeSettingsResponse;

      setRuntimeSettings(data);
      setDraftPrimary(data.primary_runtime);
      setDraftFallback(data.fallback_order);
      setSaveMessage('Runtime routing settings saved for this company.');
    } catch (err: any) {
      setSaveMessage(err.message || 'Failed to save runtime settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDigestReset = () => {
    if (!digestSettings) {
      return;
    }

    setDraftDigestEnabled(digestSettings.system_defaults.enabled);
    setDraftDigestHour(digestSettings.system_defaults.hour_utc);
    setDraftDigestMinute(digestSettings.system_defaults.minute_utc);
    setDigestSaveMessage(null);
  };

  const handleDigestSave = async () => {
    if (!selectedCompanyId) {
      return;
    }

    setSavingDigest(true);
    setDigestSaveMessage(null);
    try {
      const data = (await request(
        `/companies/${selectedCompanyId}/digest-settings`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            enabled: draftDigestEnabled,
            hour_utc: draftDigestHour,
            minute_utc: draftDigestMinute,
          }),
        }
      )) as CompanyDigestSettingsResponse;

      setDigestSettings(data);
      setDraftDigestEnabled(data.enabled);
      setDraftDigestHour(data.hour_utc);
      setDraftDigestMinute(data.minute_utc);
      setDigestSaveMessage('Daily digest settings saved for this company.');
    } catch (err: any) {
      setDigestSaveMessage(
        err.message || 'Failed to save daily digest settings.'
      );
    } finally {
      setSavingDigest(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Current session, company context, and runtime routing defaults.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Session</h3>
          <div className="mt-4 space-y-3 text-sm">
            <Row
              label="User"
              value={user?.full_name || user?.email || 'Unknown'}
            />
            <Row label="Email" value={user?.email || 'Unknown'} />
            <Row label="Authenticated" value={user ? 'Yes' : 'No'} />
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Company Context</h3>
          <div className="mt-4 space-y-3 text-sm">
            <Row
              label="Selected company"
              value={selectedCompany?.name || 'None selected'}
            />
            <Row
              label="Company ID"
              value={selectedCompanyId || 'None selected'}
            />
            <Row label="Role" value={selectedCompany?.role || 'No role'} />
            <Row label="Available companies" value={`${companies.length}`} />
          </div>
        </section>
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Product Walkthrough</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Replay the first-run tutorial whenever you want to onboard a new
              teammate or revisit the core UI.
            </p>
          </div>
          <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700">
            {hasCompleted ? 'Completed once' : 'Ready to launch'}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => startTutorial()}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90"
          >
            Start tutorial
          </button>
          <div className="text-sm text-muted-foreground">
            The tutorial opens on top of the live UI, supports skip/back, and
            automatically returns you to the Dashboard when a step depends on
            live metrics.
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">LLM Routing</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose the primary runtime for this company and reorder the
              fallback chain used by the multi-provider router.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
            <Sparkles className="h-4 w-4" />
            Primary runtime: {runtimeLabel(draftPrimary)}
          </div>
        </div>

        {!selectedCompanyId ? (
          <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Select a company to configure runtime routing.
          </div>
        ) : !runtimeSettings && loading ? (
          <div className="mt-4 text-sm text-muted-foreground">
            Loading runtime settings...
          </div>
        ) : !runtimeSettings ? (
          <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-red-600">
            {error || 'Runtime settings are currently unavailable.'}
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium">Primary runtime</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  This provider is attempted first for company heartbeats before
                  any fallbacks.
                </div>
              </div>

              <div className="grid gap-3">
                {runtimeSettings.available_runtimes.map((runtime) => (
                  <button
                    key={runtime}
                    type="button"
                    onClick={() => setDraftPrimary(runtime)}
                    aria-label={`Set ${runtime} as primary runtime`}
                    className={clsx(
                      'rounded-xl border px-4 py-3 text-left transition-colors',
                      draftPrimary === runtime
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-accent'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{runtimeLabel(runtime)}</div>
                      <span
                        className={clsx(
                          'inline-flex rounded-full border px-2 py-1 text-xs font-medium',
                          runtimeTone(runtime)
                        )}
                      >
                        {draftPrimary === runtime ? 'Primary' : 'Available'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {runtime === 'gemini' &&
                        'Fast default path for most workstreams.'}
                      {runtime === 'claude' &&
                        'Strong fallback for nuanced reasoning and long-form tasks.'}
                      {runtime === 'openai' &&
                        'Balanced fallback for general-purpose execution.'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium">Fallback order</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Reorder the provider chain used when the primary runtime
                  errors, times out, or rate limits.
                </div>
              </div>

              <div className="space-y-3">
                {draftFallback.map((runtime, index) => (
                  <div
                    key={runtime}
                    className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span
                        className={clsx(
                          'inline-flex rounded-full border px-2 py-1 text-xs font-medium',
                          runtimeTone(runtime)
                        )}
                      >
                        {runtimeLabel(runtime)}
                      </span>
                      {draftPrimary === runtime && (
                        <span className="text-xs font-medium text-primary">
                          Primary
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveRuntime(runtime, 'up')}
                        disabled={index === 0}
                        className="rounded-md border p-2 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Move ${runtime} up`}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRuntime(runtime, 'down')}
                        disabled={index === draftFallback.length - 1}
                        className="rounded-md border p-2 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Move ${runtime} down`}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-dashed bg-muted/10 p-4 text-sm">
                <div className="font-medium">System defaults</div>
                <div className="mt-1 text-muted-foreground">
                  Primary:{' '}
                  {runtimeLabel(
                    runtimeSettings.system_defaults.primary_runtime
                  )}
                  . Fallbacks:{' '}
                  {runtimeSettings.system_defaults.fallback_order
                    .map(runtimeLabel)
                    .join(' -> ')}
                  .
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save runtime settings'}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={saving}
                  className="rounded-md border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset to defaults
                </button>
                {saveMessage && (
                  <span className="text-sm text-muted-foreground">
                    {saveMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Daily Digest</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure whether this company sends an end-of-day summary to
              Slack or Discord and when it becomes eligible.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
            <Sparkles className="h-4 w-4" />
            {draftDigestEnabled
              ? `Digest at ${String(draftDigestHour).padStart(2, '0')}:${String(draftDigestMinute).padStart(2, '0')} UTC`
              : 'Digest disabled'}
          </div>
        </div>

        {!selectedCompanyId ? (
          <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Select a company to configure daily digest settings.
          </div>
        ) : !digestSettings && loading ? (
          <div className="mt-4 text-sm text-muted-foreground">
            Loading digest settings...
          </div>
        ) : !digestSettings ? (
          <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-red-600">
            {error || 'Daily digest settings are currently unavailable.'}
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              <label className="flex items-start gap-3 rounded-xl border bg-muted/20 px-4 py-4">
                <input
                  type="checkbox"
                  checked={draftDigestEnabled}
                  onChange={(event) =>
                    setDraftDigestEnabled(event.target.checked)
                  }
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Enable daily digest
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    When enabled, the worker sends one daily summary after the
                    configured UTC time if the company has a Slack or Discord
                    webhook.
                  </div>
                </div>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Hour (UTC)
                  </label>
                  <select
                    value={draftDigestHour}
                    onChange={(event) =>
                      setDraftDigestHour(Number(event.target.value))
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 24 }, (_, value) => (
                      <option key={value} value={value}>
                        {String(value).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Minute (UTC)
                  </label>
                  <select
                    value={draftDigestMinute}
                    onChange={(event) =>
                      setDraftDigestMinute(Number(event.target.value))
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {[0, 15, 30, 45].map((value) => (
                      <option key={value} value={value}>
                        {String(value).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-dashed bg-muted/10 p-4 text-sm">
                <div className="font-medium">System defaults</div>
                <div className="mt-1 text-muted-foreground">
                  {digestSettings.system_defaults.enabled
                    ? 'Enabled'
                    : 'Disabled'}{' '}
                  at{' '}
                  {String(digestSettings.system_defaults.hour_utc).padStart(
                    2,
                    '0'
                  )}
                  :
                  {String(digestSettings.system_defaults.minute_utc).padStart(
                    2,
                    '0'
                  )}{' '}
                  UTC.
                </div>
              </div>

              <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                Daily digest includes completed tasks today, currently blocked
                tasks, daily cost vs budget, and top heartbeat errors.
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleDigestSave}
                  disabled={savingDigest}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDigest ? 'Saving...' : 'Save daily digest settings'}
                </button>
                <button
                  type="button"
                  onClick={handleDigestReset}
                  disabled={savingDigest}
                  className="rounded-md border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset to defaults
                </button>
                {digestSaveMessage && (
                  <span className="text-sm text-muted-foreground">
                    {digestSaveMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

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
