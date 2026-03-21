import { describe, expect, it } from 'vitest';

import {
  extractGraphDescriptors,
  mergeKnowledgeDisplayResults,
} from '../src/services/knowledgeGraph.js';

describe('knowledge graph service helpers', () => {
  it('extracts client, project, and topic descriptors from metadata and content', () => {
    const descriptors = extractGraphDescriptors({
      title: 'Onboarding Atlas',
      content:
        'Atlas rollout requires a migration checklist and launch checklist for support.',
      metadata: {
        client_name: 'Atlas Labs',
        project: 'Q2 Rollout',
      },
    });

    expect(
      descriptors.map((descriptor) => `${descriptor.kind}:${descriptor.label}`)
    ).toEqual(
      expect.arrayContaining([
        'client:Atlas Labs',
        'project:Q2 Rollout',
        'topic:Onboarding Atlas',
      ])
    );
  });

  it('injects a small synaptic block ahead of primary knowledge results', () => {
    const merged = mergeKnowledgeDisplayResults(
      [
        {
          title: 'Runbook',
          content: 'Standard launch checklist.',
          metadata: { source: 'wiki' },
        },
        {
          title: 'Escalation',
          content: 'Call support lead before rollout.',
          metadata: { source: 'wiki' },
        },
      ],
      [
        {
          title: 'Synaptic client: Atlas Labs',
          content: 'Shared client-specific memory.',
          metadata: { source: 'knowledge_graph' },
        },
      ]
    );

    expect(merged).toEqual([
      {
        title: 'Synaptic client: Atlas Labs',
        content: 'Shared client-specific memory.',
        metadata: { source: 'knowledge_graph' },
      },
      {
        title: 'Runbook',
        content: 'Standard launch checklist.',
        metadata: { source: 'wiki' },
      },
    ]);
  });
});
