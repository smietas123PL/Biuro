import pino from 'pino';
import { env } from '../env.js';
import { getTraceId } from '../observability/tracing.js';
import { getContext } from './context.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  mixin() {
    const context = getContext();
    const traceId = getTraceId();

    return {
      ...(context?.requestId ? { request_id: context.requestId } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
      ...(context?.companyId ? { company_id: context.companyId } : {}),
      ...(context?.userId ? { user_id: context.userId } : {}),
      ...(context?.role ? { user_role: context.role } : {}),
    };
  },
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
