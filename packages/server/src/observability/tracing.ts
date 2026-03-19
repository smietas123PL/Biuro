import {
  context,
  trace,
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

type RecentSpanRecord = {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  kind: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  status_code: string;
  attributes: Record<string, unknown>;
  events: Array<{
    name: string;
    timestamp: string;
    attributes: Record<string, unknown>;
  }>;
};

class RecentSpanExporter implements SpanExporter {
  private spans: RecentSpanRecord[] = [];

  constructor(private readonly limit: number) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number }) => void
  ): void {
    for (const span of spans) {
      const durationMs = Number(
        (span.duration[0] * 1000 + span.duration[1] / 1_000_000).toFixed(3)
      );
      this.spans.push({
        trace_id: span.spanContext().traceId,
        span_id: span.spanContext().spanId,
        parent_span_id: span.parentSpanContext?.spanId,
        name: span.name,
        kind: String(span.kind),
        start_time: new Date(
          span.startTime[0] * 1000 + span.startTime[1] / 1_000_000
        ).toISOString(),
        end_time: new Date(
          span.endTime[0] * 1000 + span.endTime[1] / 1_000_000
        ).toISOString(),
        duration_ms: durationMs,
        status_code: String(span.status.code),
        attributes: { ...span.attributes },
        events: span.events.map((event) => ({
          name: event.name,
          timestamp: new Date(
            event.time[0] * 1000 + event.time[1] / 1_000_000
          ).toISOString(),
          attributes: { ...(event.attributes ?? {}) },
        })),
      });
    }

    if (this.spans.length > this.limit) {
      this.spans.splice(0, this.spans.length - this.limit);
    }

    resultCallback({ code: 0 });
  }

  async shutdown(): Promise<void> {
    return;
  }

  async forceFlush(): Promise<void> {
    return;
  }

  getFinishedSpans(limit = 50) {
    return this.spans.slice(-limit).reverse();
  }
}

let tracingInitialized = false;
let activeServiceName = 'autonomiczne-biuro';
let tracer: Tracer = trace.getTracer(activeServiceName);
let tracerProvider: NodeTracerProvider | null = null;
let recentSpanExporter = new RecentSpanExporter(200);

export function initializeTracing(config?: {
  serviceName?: string;
  enableConsoleExporter?: boolean;
  historyLimit?: number;
  otlpEndpoint?: string;
}) {
  if (tracingInitialized) {
    return;
  }

  activeServiceName = config?.serviceName || activeServiceName;
  recentSpanExporter = new RecentSpanExporter(config?.historyLimit ?? 200);
  const spanProcessors: SpanProcessor[] = [
    new SimpleSpanProcessor(recentSpanExporter),
  ];
  if (config?.enableConsoleExporter) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }
  if (config?.otlpEndpoint) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: config.otlpEndpoint,
        })
      )
    );
  }

  tracerProvider = new NodeTracerProvider({
    spanProcessors,
  });

  tracerProvider.register({
    contextManager: new AsyncLocalStorageContextManager().enable(),
  });
  tracer = trace.getTracer(activeServiceName);
  tracingInitialized = true;
}

export function getTracer() {
  return tracer;
}

export function getCurrentSpan() {
  return trace.getSpan(context.active()) ?? null;
}

export async function startActiveSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T
) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

export function getRecentSpans(limit = 50) {
  return recentSpanExporter.getFinishedSpans(limit);
}

export function getTracingServiceName() {
  return activeServiceName;
}

export function getTraceId() {
  return getCurrentSpan()?.spanContext().traceId ?? null;
}

export async function shutdownTracing() {
  if (!tracerProvider) {
    return;
  }

  await tracerProvider.shutdown();
  tracerProvider = null;
}
