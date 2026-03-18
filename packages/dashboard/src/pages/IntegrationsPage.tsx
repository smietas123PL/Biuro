import { useEffect, useState } from 'react';
import { CheckCircle2, Link2, MessageSquareText, ShieldAlert, Webhook } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type IntegrationsOverview = {
  base_url: string;
  slack: {
    configured: boolean;
    signing_secret_configured: boolean;
    events_url: string;
    slash_command_url: string;
    slash_command_name: string;
    example_payload: {
      command: string;
      text: string;
      company_id: string | null;
    };
  };
  discord: {
    configured: boolean;
    webhook_secret_configured: boolean;
    webhook_url: string;
    expected_header: string;
  };
  outgoing: {
    slack_webhook_url: string | null;
    discord_webhook_url: string | null;
  };
  webhook_tests: {
    last_test: {
      type: 'slack' | 'discord';
      status: 'success' | 'failure';
      created_at: string;
      target_url: string | null;
      error: string | null;
    } | null;
    recent: Array<{
      id: string;
      type: 'slack' | 'discord';
      status: 'success' | 'failure';
      created_at: string;
      target_url: string | null;
      error: string | null;
    }>;
  };
};

export default function IntegrationsPage() {
  const { request, loading } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [overview, setOverview] = useState<IntegrationsOverview | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testingType, setTestingType] = useState<'slack' | 'discord' | null>(null);

  useEffect(() => {
    const fetchOverview = async () => {
      if (!selectedCompanyId) {
        setOverview(null);
        setPageError(null);
        setSlackWebhookUrl('');
        setDiscordWebhookUrl('');
        return;
      }

      try {
        const data = (await request('/integrations/overview', undefined, {
          suppressError: true,
        })) as IntegrationsOverview;
        setOverview(data);
        setSlackWebhookUrl(data.outgoing.slack_webhook_url ?? '');
        setDiscordWebhookUrl(data.outgoing.discord_webhook_url ?? '');
        setPageError(null);
      } catch (err: any) {
        setOverview(null);
        setPageError(err.message || 'Failed to load integrations overview.');
      }
    };

    void fetchOverview();
  }, [request, selectedCompanyId]);

  if (!selectedCompany) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Choose a company to review integration setup.
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    setTestMessage(null);

    try {
      const data = (await request('/integrations/config', {
        method: 'PATCH',
        body: JSON.stringify({
          slack_webhook_url: slackWebhookUrl.trim(),
          discord_webhook_url: discordWebhookUrl.trim(),
        }),
      })) as { outgoing: IntegrationsOverview['outgoing'] };

      setOverview((current) =>
        current
          ? {
              ...current,
              outgoing: data.outgoing,
            }
          : current
      );
      setSlackWebhookUrl(data.outgoing.slack_webhook_url ?? '');
      setDiscordWebhookUrl(data.outgoing.discord_webhook_url ?? '');
      setSaveMessage('Webhook settings saved for this company.');
    } catch (err: any) {
      setSaveMessage(err.message || 'Failed to save webhook settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (type: 'slack' | 'discord') => {
    setTestingType(type);
    setTestMessage(null);
    setSaveMessage(null);

    try {
      await request('/integrations/test-webhook', {
        method: 'POST',
        body: JSON.stringify({
          type,
          url: type === 'slack' ? slackWebhookUrl.trim() : discordWebhookUrl.trim(),
        }),
      });
      setTestMessage(`${type === 'slack' ? 'Slack' : 'Discord'} test message sent successfully.`);
    } catch (err: any) {
      setTestMessage(err.message || `Failed to send ${type} test message.`);
    } finally {
      setTestingType(null);
    }
  };

  const hasWebhookChanges =
    slackWebhookUrl !== (overview?.outgoing.slack_webhook_url ?? '') ||
    discordWebhookUrl !== (overview?.outgoing.discord_webhook_url ?? '');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Read-only setup overview for Slack and Discord in {selectedCompany.name}.
        </p>
      </div>

      {pageError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {pageError === 'Forbidden: Insufficient permissions'
            ? 'Only owners and admins can view integration setup for this company.'
            : pageError}
        </div>
      )}

      {saveMessage && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${saveMessage.includes('saved') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {saveMessage}
        </div>
      )}

      {testMessage && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${testMessage.includes('successfully') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {testMessage}
        </div>
      )}

      {loading && !overview && (
        <div className="rounded-2xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          Loading integrations overview...
        </div>
      )}

      {overview && (
        <>
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Outgoing Notifications</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Configure per-company webhook destinations for approval requests and safety alerts.
                </p>
              </div>
              <button
                onClick={() => void handleSave()}
                disabled={saving || !hasWebhookChanges}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <WebhookEditor
                title="Slack outgoing webhook"
                description="Used for approval and safety alerts sent out of the platform."
                value={slackWebhookUrl}
                onChange={setSlackWebhookUrl}
                placeholder="https://hooks.slack.com/services/..."
                savedValue={overview.outgoing.slack_webhook_url}
                onTest={() => void handleTest('slack')}
                testing={testingType === 'slack'}
              />
              <WebhookEditor
                title="Discord outgoing webhook"
                description="Used for approval and safety alerts sent into your Discord workspace."
                value={discordWebhookUrl}
                onChange={setDiscordWebhookUrl}
                placeholder="https://discord.com/api/webhooks/..."
                savedValue={overview.outgoing.discord_webhook_url}
                onTest={() => void handleTest('discord')}
                testing={testingType === 'discord'}
              />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold">Latest Test Result</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Most recent outgoing webhook test for this company.
              </p>

              {overview.webhook_tests.last_test ? (
                <div className="mt-4 rounded-2xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${
                      overview.webhook_tests.last_test.status === 'success'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {overview.webhook_tests.last_test.status}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                      {overview.webhook_tests.last_test.type}
                    </span>
                  </div>
                  <div className="mt-3 text-sm text-muted-foreground">
                    {new Date(overview.webhook_tests.last_test.created_at).toLocaleString()}
                  </div>
                  <div className="mt-3 text-sm text-foreground">
                    {overview.webhook_tests.last_test.target_url || 'No target URL recorded'}
                  </div>
                  {overview.webhook_tests.last_test.error && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {overview.webhook_tests.last_test.error}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">
                  No webhook tests have been run for this company yet.
                </div>
              )}
            </div>

            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold">Recent Test History</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Last 10 Slack and Discord test attempts recorded in the audit log.
              </p>

              <div className="mt-4 space-y-3">
                {overview.webhook_tests.recent.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                          {entry.type}
                        </span>
                        <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${
                          entry.status === 'success'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {entry.status}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-foreground">
                      {entry.target_url || 'No target URL recorded'}
                    </div>
                    {entry.error && (
                      <div className="mt-3 text-sm text-red-700">{entry.error}</div>
                    )}
                  </div>
                ))}

                {overview.webhook_tests.recent.length === 0 && (
                  <div className="rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">
                    Test history will appear here after the first webhook test.
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <IntegrationCard
              icon={<MessageSquareText className="h-5 w-5 text-sky-600" />}
              title="Slack"
              description="Signed Slack events and slash command ingestion."
              ready={overview.slack.configured}
              helper={overview.slack.configured ? 'Signing secret detected.' : 'Missing SLACK_SIGNING_SECRET.'}
            >
              <StatusRow
                label="Secret status"
                value={overview.slack.signing_secret_configured ? 'Configured' : 'Missing'}
              />
              <StatusRow label="Slash command" value={overview.slack.slash_command_name} />
            </IntegrationCard>

            <IntegrationCard
              icon={<Webhook className="h-5 w-5 text-violet-600" />}
              title="Discord"
              description="Webhook ingestion with shared secret validation."
              ready={overview.discord.configured}
              helper={overview.discord.configured ? 'Webhook secret detected.' : 'Missing DISCORD_WEBHOOK_SECRET.'}
            >
              <StatusRow
                label="Secret status"
                value={overview.discord.webhook_secret_configured ? 'Configured' : 'Missing'}
              />
              <StatusRow label="Expected header" value={overview.discord.expected_header} />
            </IntegrationCard>
          </div>

          <section className="grid gap-4 xl:grid-cols-2">
            <SetupPanel
              title="Slack Endpoints"
              description="Use these URLs in your Slack app configuration."
              lines={[
                { label: 'Events URL', value: overview.slack.events_url },
                { label: 'Slash Command URL', value: overview.slack.slash_command_url },
              ]}
            />
            <SetupPanel
              title="Discord Endpoint"
              description="Configure your Discord webhook sender against this endpoint."
              lines={[{ label: 'Webhook URL', value: overview.discord.webhook_url }]}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <CodePanel
              title="Slack Example Payload"
              description="The company id is injected from your current company context."
              code={JSON.stringify(overview.slack.example_payload, null, 2)}
            />
            <CodePanel
              title="Expected Discord Header"
              description="Send the shared secret in this header together with the webhook body."
              code={`${overview.discord.expected_header}: <your_discord_webhook_secret>`}
            />
          </section>

          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-emerald-600" />
              <h3 className="text-lg font-semibold">Current Public Base URL</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This is the public origin currently seen by the API and used to build webhook URLs.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border bg-muted/30 px-4 py-3 text-sm text-foreground">
              <code>{overview.base_url}</code>
            </pre>
          </section>
        </>
      )}
    </div>
  );
}

function WebhookEditor({
  title,
  description,
  value,
  onChange,
  placeholder,
  savedValue,
  onTest,
  testing,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  savedValue: string | null;
  onTest: () => void;
  testing: boolean;
}) {
  return (
    <section className="rounded-2xl border bg-muted/10 p-5">
      <div>
        <h4 className="font-semibold text-foreground">{title}</h4>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-4 w-full rounded-xl border bg-background px-3 py-2 text-sm"
      />

      <div className="mt-3 text-xs text-muted-foreground">
        Saved value: {savedValue ? 'configured' : 'not configured'}
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={onTest}
          disabled={testing || !value.trim()}
          className="rounded-md border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testing ? 'Sending test...' : 'Send test'}
        </button>
      </div>
    </section>
  );
}

function IntegrationCard({
  icon,
  title,
  description,
  ready,
  helper,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  ready: boolean;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}
        >
          {ready ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {ready ? 'Ready' : 'Needs setup'}
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{helper}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function SetupPanel({
  title,
  description,
  lines,
}: {
  title: string;
  description: string;
  lines: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-4">
        {lines.map((line) => (
          <div key={line.label}>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{line.label}</div>
            <pre className="overflow-x-auto rounded-2xl border bg-muted/30 px-4 py-3 text-sm text-foreground">
              <code>{line.value}</code>
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}

function CodePanel({
  title,
  description,
  code,
}: {
  title: string;
  description: string;
  code: string;
}) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <pre className="mt-4 overflow-x-auto rounded-2xl border bg-slate-950 px-4 py-3 text-sm text-slate-100">
        <code>{code}</code>
      </pre>
    </section>
  );
}
