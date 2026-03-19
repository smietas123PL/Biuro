import { createClient, type RedisClientType } from 'redis';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';
import {
  recordEventBusDeliveryMetric,
  recordEventBusPublishMetric,
  setEventBusRedisConnected,
} from '../observability/metrics.js';

export type CompanyEventEnvelope = {
  companyId: string;
  event: string;
  data: unknown;
  timestamp: string;
  source: string;
};

type CompanyEventHandler = (
  envelope: CompanyEventEnvelope
) => void | Promise<void>;

class RealtimeEventBus {
  private publisher: RedisClientType | null = null;
  private subscriber: RedisClientType | null = null;
  private listeners = new Map<CompanyEventHandler, string>();
  private redisTransportReady = false;
  private subscriberOwner: string | null = null;

  async initialize(options: { serviceName: string; subscribe?: boolean }) {
    if (!env.REDIS_URL) {
      setEventBusRedisConnected(false);
      logger.info(
        { serviceName: options.serviceName },
        'Realtime event bus using in-memory fallback'
      );
      return;
    }

    if (!this.publisher) {
      try {
        this.publisher = createClient({ url: env.REDIS_URL });
        this.publisher.on('error', (err) => {
          logger.error(
            { err, serviceName: options.serviceName },
            'Redis event bus publisher error'
          );
        });
        await this.publisher.connect();
        this.redisTransportReady = true;
        setEventBusRedisConnected(true);
        logger.info(
          { serviceName: options.serviceName, channel: env.EVENT_BUS_CHANNEL },
          'Realtime event bus connected to Redis'
        );
      } catch (err) {
        this.redisTransportReady = false;
        setEventBusRedisConnected(false);
        this.publisher = null;
        logger.warn(
          { err, serviceName: options.serviceName },
          'Failed to connect Redis event bus, using in-memory fallback'
        );
      }
    }

    if (
      options.subscribe &&
      this.redisTransportReady &&
      !this.subscriber &&
      this.subscriberOwner !== options.serviceName
    ) {
      try {
        this.subscriber = this.publisher!.duplicate();
        this.subscriber.on('error', (err) => {
          logger.error(
            { err, serviceName: options.serviceName },
            'Redis event bus subscriber error'
          );
        });
        await this.subscriber.connect();
        await this.subscriber.subscribe(
          env.EVENT_BUS_CHANNEL,
          async (message) => {
            await this.handleRedisMessage(message);
          }
        );
        this.subscriberOwner = options.serviceName;
      } catch (err) {
        setEventBusRedisConnected(false);
        logger.warn(
          { err, serviceName: options.serviceName },
          'Failed to subscribe to Redis event bus, realtime fan-out limited to local process'
        );
        if (this.subscriber) {
          await this.subscriber.quit().catch(() => undefined);
        }
        this.subscriber = null;
        this.subscriberOwner = null;
      }
    }
  }

  subscribe(consumer: string, handler: CompanyEventHandler) {
    this.listeners.set(handler, consumer);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async publish(
    companyId: string,
    event: string,
    data: unknown,
    source = 'app'
  ) {
    const envelope: CompanyEventEnvelope = {
      companyId,
      event,
      data,
      timestamp: new Date().toISOString(),
      source,
    };

    if (this.redisTransportReady && this.publisher) {
      recordEventBusPublishMetric({ event, transport: 'redis' });
      await this.publisher.publish(
        env.EVENT_BUS_CHANNEL,
        JSON.stringify(envelope)
      );
      return envelope;
    }

    recordEventBusPublishMetric({ event, transport: 'memory' });
    await this.dispatch(envelope, 'memory');
    return envelope;
  }

  async close() {
    const subscriber = this.subscriber;
    const publisher = this.publisher;

    this.subscriber = null;
    this.publisher = null;
    this.subscriberOwner = null;
    this.redisTransportReady = false;
    this.listeners.clear();
    setEventBusRedisConnected(false);

    if (subscriber) {
      await subscriber.quit().catch(() => undefined);
    }

    if (publisher) {
      await publisher.quit().catch(() => undefined);
    }
  }

  private async handleRedisMessage(message: string) {
    try {
      const parsed = JSON.parse(message) as CompanyEventEnvelope;
      if (
        !parsed ||
        typeof parsed.companyId !== 'string' ||
        typeof parsed.event !== 'string'
      ) {
        logger.warn({ message }, 'Dropping malformed realtime event payload');
        return;
      }

      await this.dispatch(parsed, 'redis');
    } catch (err) {
      logger.warn({ err, message }, 'Failed to parse realtime event payload');
    }
  }

  private async dispatch(
    envelope: CompanyEventEnvelope,
    transport: 'memory' | 'redis'
  ) {
    for (const [handler, consumer] of this.listeners.entries()) {
      recordEventBusDeliveryMetric({
        event: envelope.event,
        transport,
        consumer,
      });
      await handler(envelope);
    }
  }
}

export const realtimeEventBus = new RealtimeEventBus();

export async function initializeRealtimeEventBus(options: {
  serviceName: string;
  subscribe?: boolean;
}) {
  await realtimeEventBus.initialize(options);
}

export function subscribeToCompanyEvents(
  consumer: string,
  handler: (envelope: CompanyEventEnvelope) => void | Promise<void>
) {
  return realtimeEventBus.subscribe(consumer, handler);
}

export async function broadcastCompanyEvent(
  companyId: string,
  event: string,
  data: unknown,
  source = 'app'
) {
  return realtimeEventBus.publish(companyId, event, data, source);
}

export async function closeRealtimeEventBus() {
  await realtimeEventBus.close();
}
