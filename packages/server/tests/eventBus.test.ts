import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  REDIS_URL: undefined,
  EVENT_BUS_CHANNEL: 'biuro:events',
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const recordEventBusPublishMetricMock = vi.hoisted(() => vi.fn());
const recordEventBusDeliveryMetricMock = vi.hoisted(() => vi.fn());
const setEventBusRedisConnectedMock = vi.hoisted(() => vi.fn());

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

vi.mock('../src/observability/metrics.js', () => ({
  recordEventBusPublishMetric: recordEventBusPublishMetricMock,
  recordEventBusDeliveryMetric: recordEventBusDeliveryMetricMock,
  setEventBusRedisConnected: setEventBusRedisConnectedMock,
}));

import {
  broadcastCompanyEvent,
  closeRealtimeEventBus,
  initializeRealtimeEventBus,
  subscribeToCompanyEvents,
} from '../src/realtime/eventBus.js';

describe('realtime event bus', () => {
  beforeEach(() => {
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
    recordEventBusPublishMetricMock.mockReset();
    recordEventBusDeliveryMetricMock.mockReset();
    setEventBusRedisConnectedMock.mockReset();
  });

  afterEach(async () => {
    await closeRealtimeEventBus();
  });

  it('delivers company events locally when Redis is not configured', async () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCompanyEvents('test-subscriber', handler);

    await initializeRealtimeEventBus({
      serviceName: 'test',
      subscribe: true,
    });
    await broadcastCompanyEvent(
      'company-1',
      'agent.working',
      {
        agentId: 'agent-1',
      },
      'worker'
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        event: 'agent.working',
        data: {
          agentId: 'agent-1',
        },
        source: 'worker',
      })
    );
    expect(recordEventBusPublishMetricMock).toHaveBeenCalledWith({
      event: 'agent.working',
      transport: 'memory',
    });
    expect(recordEventBusDeliveryMetricMock).toHaveBeenCalledWith({
      event: 'agent.working',
      transport: 'memory',
      consumer: 'test-subscriber',
    });

    unsubscribe();
  });
});
