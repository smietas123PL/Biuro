import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    companyId: string;
    role: string;
  };
}

export interface RequestContext {
  companyId?: string;
  userId?: string;
  role?: string;
}

export const contextStore = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return contextStore.getStore();
}
