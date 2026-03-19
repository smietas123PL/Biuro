import type {
  TemplateMarketplaceDetail,
  TemplateMarketplaceListResponse,
  TemplateMarketplaceSourceType,
} from '@biuro/shared';
import { env } from '../env.js';
import { CompanyTemplateSchema, type CompanyTemplate } from './template.js';
import { templatePresetsCatalog } from './templatePresets.js';

type MarketplaceTemplateManifestEntry = {
  id: string;
  name: string;
  description: string;
  recommended_for: string;
  vendor: string;
  categories: string[];
  featured?: boolean;
  badge?: string | null;
  source_url?: string | null;
  template_url?: string | null;
  template?: CompanyTemplate;
};

type MarketplaceManifest = {
  catalog: {
    name: string;
    source_type: TemplateMarketplaceSourceType;
    source_url?: string | null;
  };
  templates: MarketplaceTemplateManifestEntry[];
};

let cachedManifest: { value: MarketplaceManifest; fetchedAt: number } | null =
  null;

function summarizeTemplate(template: CompanyTemplate) {
  return {
    goals: template.goals.length,
    agents: template.agents.length,
    tools: template.tools.length,
    policies: template.policies.length,
  };
}

function buildBundledMarketplaceManifest(): MarketplaceManifest {
  return {
    catalog: {
      name: 'Biuro Marketplace',
      source_type: 'bundled',
      source_url: env.TEMPLATE_MARKETPLACE_URL ?? null,
    },
    templates: templatePresetsCatalog.map((preset, index) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      recommended_for: preset.recommended_for,
      vendor: 'Biuro Labs',
      categories:
        index === 0
          ? ['startup', 'founder', 'operations']
          : index === 1
            ? ['content', 'marketing', 'publishing']
            : ['engineering', 'delivery', 'quality'],
      featured: index === 0,
      badge: index === 0 ? 'Editor pick' : null,
      source_url: `https://marketplace.biuro.ai/templates/${preset.id}`,
      template: preset.template,
    })),
  };
}

function normalizeManifest(
  raw: unknown,
  sourceUrl: string
): MarketplaceManifest {
  const parsed = raw as {
    catalog?: {
      name?: unknown;
      source_type?: unknown;
      source_url?: unknown;
    };
    templates?: unknown[];
  };

  const templates = Array.isArray(parsed.templates) ? parsed.templates : [];
  const normalizedTemplates: MarketplaceTemplateManifestEntry[] = templates.map(
    (entry, index) => {
      const item = entry as Record<string, unknown>;
      const parsedTemplate = item.template
        ? CompanyTemplateSchema.safeParse(item.template)
        : null;

      return {
        id:
          typeof item.id === 'string' && item.id.trim().length > 0
            ? item.id
            : `marketplace-template-${index + 1}`,
        name:
          typeof item.name === 'string' && item.name.trim().length > 0
            ? item.name
            : `Marketplace Template ${index + 1}`,
        description:
          typeof item.description === 'string'
            ? item.description
            : 'No description provided.',
        recommended_for:
          typeof item.recommended_for === 'string'
            ? item.recommended_for
            : 'General-purpose teams.',
        vendor:
          typeof item.vendor === 'string' && item.vendor.trim().length > 0
            ? item.vendor
            : 'Marketplace creator',
        categories: Array.isArray(item.categories)
          ? item.categories.filter(
              (value): value is string =>
                typeof value === 'string' && value.trim().length > 0
            )
          : [],
        featured: item.featured === true,
        badge:
          typeof item.badge === 'string' && item.badge.trim().length > 0
            ? item.badge
            : null,
        source_url:
          typeof item.source_url === 'string' ? item.source_url : null,
        template_url:
          typeof item.template_url === 'string' ? item.template_url : null,
        template: parsedTemplate?.success ? parsedTemplate.data : undefined,
      };
    }
  );

  return {
    catalog: {
      name:
        typeof parsed.catalog?.name === 'string' &&
        parsed.catalog.name.trim().length > 0
          ? parsed.catalog.name
          : 'Biuro Marketplace',
      source_type: 'remote',
      source_url: sourceUrl,
    },
    templates: normalizedTemplates,
  };
}

async function loadMarketplaceManifest(): Promise<MarketplaceManifest> {
  const now = Date.now();
  if (
    cachedManifest &&
    now - cachedManifest.fetchedAt < env.TEMPLATE_MARKETPLACE_CACHE_TTL_MS
  ) {
    return cachedManifest.value;
  }

  if (!env.TEMPLATE_MARKETPLACE_URL) {
    const bundledManifest = buildBundledMarketplaceManifest();
    cachedManifest = { value: bundledManifest, fetchedAt: now };
    return bundledManifest;
  }

  try {
    const response = await fetch(env.TEMPLATE_MARKETPLACE_URL);
    if (!response.ok) {
      throw new Error(
        `Marketplace manifest request failed with ${response.status}`
      );
    }

    const payload = await response.json();
    const manifest = normalizeManifest(payload, env.TEMPLATE_MARKETPLACE_URL);
    cachedManifest = { value: manifest, fetchedAt: now };
    return manifest;
  } catch {
    const bundledManifest = buildBundledMarketplaceManifest();
    cachedManifest = { value: bundledManifest, fetchedAt: now };
    return bundledManifest;
  }
}

async function resolveTemplate(
  entry: MarketplaceTemplateManifestEntry
): Promise<CompanyTemplate> {
  if (entry.template) {
    return entry.template;
  }

  if (!entry.template_url) {
    throw new Error(
      'Marketplace template has no inline template or template_url'
    );
  }

  const response = await fetch(entry.template_url);
  if (!response.ok) {
    throw new Error(
      `Marketplace template request failed with ${response.status}`
    );
  }

  const payload = await response.json();
  return CompanyTemplateSchema.parse(payload);
}

export async function listMarketplaceTemplates(): Promise<TemplateMarketplaceListResponse> {
  const manifest = await loadMarketplaceManifest();

  return {
    catalog: manifest.catalog,
    templates: manifest.templates.map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      recommended_for: entry.recommended_for,
      vendor: entry.vendor,
      categories: entry.categories,
      featured: entry.featured ?? false,
      badge: entry.badge ?? null,
      source_url: entry.source_url ?? entry.template_url ?? null,
      source_type: manifest.catalog.source_type,
      summary: summarizeTemplate(
        entry.template ?? {
          version: '1.1',
          company: { name: entry.name, mission: entry.description },
          roles: [],
          goals: [],
          policies: [],
          tools: [],
          agents: [],
          budgets: [],
        }
      ),
    })),
  };
}

export async function getMarketplaceTemplateById(
  id: string
): Promise<TemplateMarketplaceDetail | null> {
  const manifest = await loadMarketplaceManifest();
  const entry = manifest.templates.find((template) => template.id === id);
  if (!entry) {
    return null;
  }

  const template = await resolveTemplate(entry);
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    recommended_for: entry.recommended_for,
    vendor: entry.vendor,
    categories: entry.categories,
    featured: entry.featured ?? false,
    badge: entry.badge ?? null,
    source_url: entry.source_url ?? entry.template_url ?? null,
    source_type: manifest.catalog.source_type,
    summary: summarizeTemplate(template),
    template: template as TemplateMarketplaceDetail['template'],
  };
}

export function resetMarketplaceCacheForTests() {
  cachedManifest = null;
}
