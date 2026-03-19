export type ApiTraceSnapshot = {
  traceId: string;
  path: string;
  method: string;
  status: number;
  capturedAt: string;
};

export type ObservabilitySpanEvent = {
  name: string;
  timestamp: string;
  attributes: Record<string, unknown>;
};

export type ObservabilitySpanItem = {
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
  events: ObservabilitySpanEvent[];
};

export type ObservabilityRecentTracesResponse = {
  generated_at: string;
  service: string;
  count: number;
  items: ObservabilitySpanItem[];
};

export type ObservabilityTraceDetailResponse = {
  generated_at: string;
  service: string;
  trace_id: string;
  summary: {
    span_count: number;
    started_at: string;
    ended_at: string;
    duration_ms: number;
  };
  items: ObservabilitySpanItem[];
};
