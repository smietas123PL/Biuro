import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

const METRICS_PREFIX = 'biuro_';

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
  prefix: METRICS_PREFIX,
});

export const httpRequestsTotal = new Counter({
  name: `${METRICS_PREFIX}http_requests_total`,
  help: 'Total number of HTTP requests processed by the API.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

export const httpRequestDurationMs = new Histogram({
  name: `${METRICS_PREFIX}http_request_duration_ms`,
  help: 'HTTP request duration in milliseconds.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000],
  registers: [metricsRegistry],
});

export const heartbeatRunsTotal = new Counter({
  name: `${METRICS_PREFIX}heartbeat_runs_total`,
  help: 'Total number of agent heartbeats processed by the worker.',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const heartbeatDurationMs = new Histogram({
  name: `${METRICS_PREFIX}heartbeat_duration_ms`,
  help: 'Duration of agent heartbeat executions in milliseconds.',
  labelNames: ['status'] as const,
  buckets: [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000],
  registers: [metricsRegistry],
});

export const activeHeartbeatsGauge = new Gauge({
  name: `${METRICS_PREFIX}heartbeats_active`,
  help: 'Current number of active heartbeats in flight.',
  registers: [metricsRegistry],
});

export const toolCallsTotal = new Counter({
  name: `${METRICS_PREFIX}tool_calls_total`,
  help: 'Total number of tool calls executed by agents.',
  labelNames: ['tool_name', 'tool_type', 'status'] as const,
  registers: [metricsRegistry],
});

export const toolDurationMs = new Histogram({
  name: `${METRICS_PREFIX}tool_duration_ms`,
  help: 'Duration of tool executions in milliseconds.',
  labelNames: ['tool_name', 'tool_type', 'status'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000],
  registers: [metricsRegistry],
});

export const wsConnectionAttemptsTotal = new Counter({
  name: `${METRICS_PREFIX}ws_connection_attempts_total`,
  help: 'Total number of websocket connection attempts.',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});

export const wsConnectionsActive = new Gauge({
  name: `${METRICS_PREFIX}ws_connections_active`,
  help: 'Current number of active websocket connections.',
  registers: [metricsRegistry],
});

export const wsRoomsActive = new Gauge({
  name: `${METRICS_PREFIX}ws_rooms_active`,
  help: 'Current number of active websocket rooms (companies) with at least one client.',
  registers: [metricsRegistry],
});

export const wsBroadcastEventsTotal = new Counter({
  name: `${METRICS_PREFIX}ws_broadcast_events_total`,
  help: 'Total number of websocket broadcast events sent to rooms.',
  labelNames: ['event'] as const,
  registers: [metricsRegistry],
});

export const eventBusPublishesTotal = new Counter({
  name: `${METRICS_PREFIX}event_bus_publishes_total`,
  help: 'Total number of realtime events published to the event bus.',
  labelNames: ['event', 'transport'] as const,
  registers: [metricsRegistry],
});

export const eventBusDeliveriesTotal = new Counter({
  name: `${METRICS_PREFIX}event_bus_deliveries_total`,
  help: 'Total number of realtime events delivered to local subscribers.',
  labelNames: ['event', 'transport', 'consumer'] as const,
  registers: [metricsRegistry],
});

export const eventBusRedisConnected = new Gauge({
  name: `${METRICS_PREFIX}event_bus_redis_connected`,
  help: 'Whether the process is currently connected to Redis for realtime event delivery.',
  registers: [metricsRegistry],
});

export function recordHttpRequestMetric(input: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}) {
  const labels = {
    method: input.method,
    route: input.route,
    status_code: String(input.statusCode),
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationMs.observe(labels, input.durationMs);
}

export function recordHeartbeatMetric(status: string, durationMs: number) {
  heartbeatRunsTotal.inc({ status });
  heartbeatDurationMs.observe({ status }, durationMs);
}

export function recordToolCallMetric(input: {
  toolName: string;
  toolType: string;
  status: string;
  durationMs: number;
}) {
  const labels = {
    tool_name: input.toolName,
    tool_type: input.toolType,
    status: input.status,
  };
  toolCallsTotal.inc(labels);
  toolDurationMs.observe(labels, input.durationMs);
}

export function setWsSnapshot(input: { connections: number; rooms: number }) {
  wsConnectionsActive.set(input.connections);
  wsRoomsActive.set(input.rooms);
}

export function recordEventBusPublishMetric(input: {
  event: string;
  transport: 'memory' | 'redis';
}) {
  eventBusPublishesTotal.inc({
    event: input.event,
    transport: input.transport,
  });
}

export function recordEventBusDeliveryMetric(input: {
  event: string;
  transport: 'memory' | 'redis';
  consumer: string;
}) {
  eventBusDeliveriesTotal.inc({
    event: input.event,
    transport: input.transport,
    consumer: input.consumer,
  });
}

export function setEventBusRedisConnected(connected: boolean) {
  eventBusRedisConnected.set(connected ? 1 : 0);
}

export async function renderMetrics() {
  return metricsRegistry.metrics();
}
