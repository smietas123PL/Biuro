import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const previewImportMock = vi.hoisted(() => vi.fn());
const importCompanyMock = vi.hoisted(() => vi.fn());
const listMarketplaceTemplatesMock = vi.hoisted(() => vi.fn());
const getMarketplaceTemplateByIdMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole:
    () =>
    (
      req: express.Request & {
        user?: { id: string; companyId?: string; role: string };
      },
      _res: express.Response,
      next: express.NextFunction
    ) => {
      const testCompanyIdHeader = req.headers['x-test-company-id'];
      req.user = {
        id: 'user-1',
        companyId:
          typeof testCompanyIdHeader === 'string'
            ? testCompanyIdHeader
            : undefined,
        role: 'owner',
      };
      next();
    },
}));

vi.mock('../src/services/template.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/services/template.js')
  >('../src/services/template.js');
  return {
    ...actual,
    TemplateService: {
      previewImport: previewImportMock,
      importCompany: importCompanyMock,
    },
  };
});

vi.mock('../src/services/templateMarketplace.js', () => ({
  listMarketplaceTemplates: listMarketplaceTemplatesMock,
  getMarketplaceTemplateById: getMarketplaceTemplateByIdMock,
}));

import templatesRouter from '../src/routes/templates.js';

describe('template marketplace routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    previewImportMock.mockReset();
    importCompanyMock.mockReset();
    listMarketplaceTemplatesMock.mockReset();
    getMarketplaceTemplateByIdMock.mockReset();

    const app = express();
    app.use(express.json());
    app.use('/api/templates', templatesRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/templates`;
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

  function fetchWithCompany(path: string, init?: RequestInit) {
    return fetch(path, {
      ...init,
      headers: {
        'x-test-company-id': 'company-1',
        ...(init?.headers ?? {}),
      },
    });
  }

  it('lists marketplace templates from the service catalog', async () => {
    listMarketplaceTemplatesMock.mockResolvedValue({
      catalog: {
        name: 'Biuro Marketplace',
        source_type: 'remote',
        source_url: 'https://marketplace.test/templates.json',
      },
      templates: [{ id: 'market-1', name: 'Support Ops Pack' }],
    });

    const response = await fetchWithCompany(`${baseUrl}/marketplace`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.catalog.name).toBe('Biuro Marketplace');
    expect(data.templates[0].id).toBe('market-1');
  });

  it('imports a marketplace template through the shared template pipeline', async () => {
    getMarketplaceTemplateByIdMock.mockResolvedValue({
      id: 'market-1',
      name: 'Support Ops Pack',
      vendor: 'Ops Guild',
      source_url: 'https://marketplace.test/support-ops-pack',
      template: {
        version: '1.1',
        company: {
          name: 'Support Ops Pack',
          mission: 'Ship support operations.',
        },
        roles: [],
        goals: [],
        policies: [],
        tools: [],
        agents: [],
        budgets: [],
      },
    });
    importCompanyMock.mockResolvedValue({
      goals_added: 1,
      agents_added: 2,
    });
    dbMock.query.mockResolvedValue({ rowCount: 1, rows: [] });

    const response = await fetchWithCompany(
      `${baseUrl}/import-marketplace/market-1`,
      {
      method: 'POST',
      }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(importCompanyMock).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        company: expect.objectContaining({ name: 'Support Ops Pack' }),
      }),
      { preserveCompanyIdentity: true }
    );
    expect(data.template).toEqual({
      id: 'market-1',
      name: 'Support Ops Pack',
      vendor: 'Ops Guild',
    });
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining(`'template.imported', 'template_marketplace'`),
      [
        'company-1',
        JSON.stringify({
          source: 'marketplace',
          marketplace_id: 'market-1',
          marketplace_name: 'Support Ops Pack',
          vendor: 'Ops Guild',
          source_url: 'https://marketplace.test/support-ops-pack',
          requested_by_user_id: 'user-1',
          requested_by_role: 'owner',
          preserve_company_identity: true,
          changes: {
            goals_added: 1,
            agents_added: 2,
          },
        }),
      ]
    );
  });
});
