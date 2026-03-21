import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addDocumentMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());
const searchGraphSafeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/knowledge.js', () => ({
  KnowledgeService: {
    addDocument: addDocumentMock,
    search: searchMock,
  },
}));

vi.mock('../src/services/knowledgeGraph.js', () => ({
  KnowledgeGraphService: {
    searchSafe: searchGraphSafeMock,
  },
}));

import knowledgeRouter from '../src/routes/knowledge.js';

describe('knowledge routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    addDocumentMock.mockReset();
    searchMock.mockReset();
    searchGraphSafeMock.mockReset();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const companyId = req.headers['x-company-id'];
      (
        req as express.Request & {
          user?: { id: string; companyId?: string; role?: string };
        }
      ).user =
        typeof companyId === 'string'
          ? {
              id: 'user-1',
              companyId,
              role: 'member',
            }
          : undefined;
      next();
    });
    app.use('/api/knowledge', knowledgeRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/knowledge`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it('creates a knowledge document for the active company context', async () => {
    addDocumentMock.mockResolvedValue('doc-1');

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-company-id': 'company-1',
      },
      body: JSON.stringify({
        title: 'Launch brief',
        content: 'Share the launch checklist with support.',
        metadata: {
          source: 'handbook',
        },
      }),
    });

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ id: 'doc-1' });
    expect(addDocumentMock).toHaveBeenCalledWith(
      'company-1',
      'Launch brief',
      'Share the launch checklist with support.',
      {
        source: 'handbook',
      }
    );
  });

  it('searches knowledge with the active company context and consumer tag', async () => {
    searchMock.mockResolvedValue([
      {
        title: 'Support notes',
        content: 'Enterprise users need a launch checklist.',
        metadata: { source: 'wiki' },
      },
    ]);

    const response = await fetch(`${baseUrl}/search?q=launch checklist&limit=3`, {
      headers: {
        'x-company-id': 'company-1',
      },
    });

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      {
        title: 'Support notes',
        content: 'Enterprise users need a launch checklist.',
        metadata: { source: 'wiki' },
      },
    ]);
    expect(searchMock).toHaveBeenCalledWith(
      'company-1',
      'launch checklist',
      3,
      {
        consumer: 'knowledge_api',
      }
    );
  });

  it('returns 400 when company context is missing', async () => {
    const response = await fetch(`${baseUrl}/search?q=launch checklist`);

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: 'Company ID missing',
    });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('searches the synaptic knowledge graph for the active company context', async () => {
    searchGraphSafeMock.mockResolvedValue([
      {
        title: 'Synaptic client: Atlas Labs',
        content: 'Shared rollout memory.',
        metadata: { source: 'knowledge_graph' },
      },
    ]);

    const response = await fetch(
      `${baseUrl}/graph/search?q=atlas rollout&limit=2`,
      {
        headers: {
          'x-company-id': 'company-1',
        },
      }
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      {
        title: 'Synaptic client: Atlas Labs',
        content: 'Shared rollout memory.',
        metadata: { source: 'knowledge_graph' },
      },
    ]);
    expect(searchGraphSafeMock).toHaveBeenCalledWith(
      'company-1',
      'atlas rollout',
      2
    );
  });
});
