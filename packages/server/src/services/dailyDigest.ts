import { db } from '../db/client.js';
import { env } from '../env.js';
import { deliverOutgoingWebhooks } from './outgoingWebhooks.js';

type DigestCompany = {
  id: string;
  name: string;
  slack_webhook_url: string | null;
  discord_webhook_url: string | null;
  config?: unknown;
};

export type DailyDigestSummary = {
  companyId: string;
  companyName: string;
  completedTasksToday: number;
  blockedTasks: number;
  dailyCostUsd: number;
  dailyBudgetUsd: number;
  topErrors: Array<{
    message: string;
    count: number;
  }>;
};

export type CompanyDigestSettings = {
  enabled: boolean;
  hourUtc: number;
  minuteUtc: number;
};

export function getDefaultDailyDigestSettings(): CompanyDigestSettings {
  return {
    enabled: env.DAILY_DIGEST_ENABLED,
    hourUtc: env.DAILY_DIGEST_HOUR_UTC,
    minuteUtc: env.DAILY_DIGEST_MINUTE_UTC,
  };
}

export function extractCompanyDigestSettings(
  config: unknown
): CompanyDigestSettings {
  const defaults = getDefaultDailyDigestSettings();
  if (!config || typeof config !== 'object') {
    return defaults;
  }

  const candidate = config as {
    daily_digest_enabled?: unknown;
    daily_digest_hour_utc?: unknown;
    daily_digest_minute_utc?: unknown;
  };

  const hourCandidate = Number(candidate.daily_digest_hour_utc);
  const minuteCandidate = Number(candidate.daily_digest_minute_utc);

  return {
    enabled:
      typeof candidate.daily_digest_enabled === 'boolean'
        ? candidate.daily_digest_enabled
        : defaults.enabled,
    hourUtc:
      Number.isInteger(hourCandidate) &&
      hourCandidate >= 0 &&
      hourCandidate <= 23
        ? hourCandidate
        : defaults.hourUtc,
    minuteUtc:
      Number.isInteger(minuteCandidate) &&
      minuteCandidate >= 0 &&
      minuteCandidate <= 59
        ? minuteCandidate
        : defaults.minuteUtc,
  };
}

function startOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

function endOfUtcDay(value: Date) {
  const start = startOfUtcDay(value);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function toFloat(value: unknown) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function buildErrorLines(errors: DailyDigestSummary['topErrors']) {
  if (errors.length === 0) {
    return ['Top errors: none recorded today'];
  }

  return [
    'Top errors:',
    ...errors.map(
      (error, index) => `${index + 1}. ${error.message} (${error.count})`
    ),
  ];
}

export function formatDailyDigestMessage(summary: DailyDigestSummary) {
  return [
    `Daily Digest - ${summary.companyName}`,
    `Completed today: ${summary.completedTasksToday}`,
    `Blocked right now: ${summary.blockedTasks}`,
    `Daily cost vs budget: ${formatMoney(summary.dailyCostUsd)} / ${formatMoney(summary.dailyBudgetUsd)}`,
    ...buildErrorLines(summary.topErrors),
  ].join('\n');
}

export function isDailyDigestWindowOpen(now: Date) {
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const targetMinutes =
    env.DAILY_DIGEST_HOUR_UTC * 60 + env.DAILY_DIGEST_MINUTE_UTC;
  return currentMinutes >= targetMinutes;
}

export function isCompanyDigestDue(settings: CompanyDigestSettings, now: Date) {
  if (!settings.enabled) {
    return false;
  }

  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const targetMinutes = settings.hourUtc * 60 + settings.minuteUtc;
  return currentMinutes >= targetMinutes;
}

export async function generateDailyDigest(
  companyId: string,
  now: Date = new Date()
): Promise<DailyDigestSummary | null> {
  const dayStart = startOfUtcDay(now);
  const dayEnd = endOfUtcDay(now);

  const [companyRes, completedRes, blockedRes, costRes, budgetRes, errorsRes] =
    await Promise.all([
      db.query<DigestCompany>(
        'SELECT id, name, slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1',
        [companyId]
      ),
      db.query(
        `SELECT COUNT(*) AS count
       FROM tasks
       WHERE company_id = $1
         AND completed_at >= $2
         AND completed_at < $3`,
        [companyId, dayStart, dayEnd]
      ),
      db.query(
        `SELECT COUNT(*) AS count
       FROM tasks
       WHERE company_id = $1
         AND status = 'blocked'`,
        [companyId]
      ),
      db.query(
        `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
       FROM audit_log
       WHERE company_id = $1
         AND created_at >= $2
         AND created_at < $3`,
        [companyId, dayStart, dayEnd]
      ),
      db.query(
        `SELECT COALESCE(SUM(COALESCE(b.limit_usd, a.monthly_budget_usd, 0)), 0)::float AS total
       FROM agents a
       LEFT JOIN budgets b
         ON b.agent_id = a.id
        AND b.month = date_trunc('month', $2::timestamptz)::date
       WHERE a.company_id = $1
         AND a.status != 'terminated'`,
        [companyId, dayStart]
      ),
      db.query(
        `SELECT
         COALESCE(NULLIF(h.details->>'error', ''), NULLIF(h.details->>'message', ''), 'Unknown heartbeat error') AS message,
         COUNT(*)::int AS count
       FROM heartbeats h
       JOIN agents a ON a.id = h.agent_id
       WHERE a.company_id = $1
         AND h.status = 'error'
         AND h.created_at >= $2
         AND h.created_at < $3
       GROUP BY 1
       ORDER BY count DESC, message ASC
       LIMIT 3`,
        [companyId, dayStart, dayEnd]
      ),
    ]);

  const company = companyRes.rows[0];
  if (!company) {
    return null;
  }

  return {
    companyId: company.id,
    companyName: company.name,
    completedTasksToday: toCount(completedRes.rows[0]?.count),
    blockedTasks: toCount(blockedRes.rows[0]?.count),
    dailyCostUsd: toFloat(costRes.rows[0]?.total),
    dailyBudgetUsd: toFloat(budgetRes.rows[0]?.total),
    topErrors: errorsRes.rows.map((row) => ({
      message: String(
        (row as { message?: unknown }).message ?? 'Unknown heartbeat error'
      ),
      count: toCount((row as { count?: unknown }).count),
    })),
  };
}

export async function sendDailyDigest(
  companyId: string,
  now: Date = new Date()
) {
  const summary = await generateDailyDigest(companyId, now);
  if (!summary) {
    return null;
  }

  const companyRes = await db.query<DigestCompany>(
    'SELECT id, name, slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1',
    [companyId]
  );
  const company = companyRes.rows[0];
  if (!company) {
    return null;
  }

  const message = formatDailyDigestMessage(summary);
  const attempts = await deliverOutgoingWebhooks({
    companyId: company.id,
    event: 'digest.daily_sent',
    slackWebhookUrl: company.slack_webhook_url,
    slackText: message,
    discordWebhookUrl: company.discord_webhook_url,
    discordMessage: message,
    metadata: {
      digest_type: 'daily',
      summary,
    },
  });

  await db.query(
    `INSERT INTO audit_log (company_id, action, entity_type, details)
     VALUES ($1, 'digest.daily_sent', 'daily_digest', $2)`,
    [
      company.id,
      JSON.stringify({
        generated_at: now.toISOString(),
        summary,
        attempts,
      }),
    ]
  );

  return {
    summary,
    attempts,
  };
}

export async function dispatchDueDailyDigests(now: Date = new Date()) {
  if (!env.DAILY_DIGEST_ENABLED || !isDailyDigestWindowOpen(now)) {
    return [];
  }

  const dayStart = startOfUtcDay(now);
  const dayEnd = endOfUtcDay(now);

  const companiesRes = await db.query<DigestCompany>(
    `SELECT c.id, c.name, c.slack_webhook_url, c.discord_webhook_url, c.config
     FROM companies c
     WHERE (c.slack_webhook_url IS NOT NULL OR c.discord_webhook_url IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1
         FROM audit_log al
         WHERE al.company_id = c.id
           AND al.action = 'digest.daily_sent'
           AND al.created_at >= $1
           AND al.created_at < $2
       )
     ORDER BY c.id ASC`,
    [dayStart, dayEnd]
  );

  const results = [];
  for (const company of companiesRes.rows) {
    const digestSettings = extractCompanyDigestSettings(
      (company as DigestCompany & { config?: unknown }).config
    );
    if (!isCompanyDigestDue(digestSettings, now)) {
      continue;
    }
    const result = await sendDailyDigest(company.id, now);
    if (result) {
      results.push(result);
    }
  }

  return results;
}
