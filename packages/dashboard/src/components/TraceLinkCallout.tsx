import { useState } from 'react';
import type { ApiTraceSnapshot } from '../hooks/useApi';
import { buildGrafanaTraceExploreUrl } from '../lib/grafana';

function shortenTraceId(traceId: string) {
  if (traceId.length <= 16) {
    return traceId;
  }

  return `${traceId.slice(0, 8)}...${traceId.slice(-8)}`;
}

export function TraceLinkCallout({
  trace,
  title = 'Trace Context',
  body,
  compact = false,
}: {
  trace: ApiTraceSnapshot | null;
  title?: string;
  body?: string;
  compact?: boolean;
}) {
  if (!trace) {
    return null;
  }

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const grafanaUrl = buildGrafanaTraceExploreUrl(trace);
  const traceIdLabel = shortenTraceId(trace.traceId);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(trace.traceId);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  return (
    <div className={`rounded-xl border bg-muted/20 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">{title}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {body || `Latest trace ${traceIdLabel} from ${trace.method} ${trace.path}`}
            </div>
          </div>
          <a
            href={grafanaUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-sky-700 transition-colors hover:bg-sky-100"
          >
            Open in Grafana
          </a>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/60 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Trace ID</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 text-[11px] text-foreground">{traceIdLabel}</code>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-full border px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent"
            >
              {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy trace ID'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
