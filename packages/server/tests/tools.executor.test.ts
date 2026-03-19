import { mkdir, readFile, rm } from 'fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

const runSandboxedBashCommandMock = vi.hoisted(() => vi.fn());

vi.mock('../src/tools/bashSandbox.js', () => ({
  runSandboxedBashCommand: runSandboxedBashCommandMock,
  validateSandboxedCommand: (command: string) => {
    if (/(\&\&|\|\||[;|><`]|[$][(]|\r|\n)/.test(command)) {
      throw new Error('Unsafe shell control operators are not allowed');
    }

    return command;
  },
}));

import { executeTool } from '../src/tools/executor.js';
import { env } from '../src/env.js';

describe('tools executor builtins', () => {
  const workspaceDir = path.join(path.resolve(env.WORKSPACE_ROOT), 'tmp-test-artifacts');

  beforeEach(async () => {
    dbMock.query.mockReset();
    runSandboxedBashCommandMock.mockReset();
    await mkdir(workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('executes web_search against a real search response shape and logs the tool call', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            name: 'web_search',
            type: 'builtin',
            company_id: 'company-1',
            config: {},
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Heading: 'OpenAI',
        AbstractText: 'OpenAI builds AI systems and products.',
        AbstractURL: 'https://openai.com/',
        Results: [
          {
            FirstURL: 'https://platform.openai.com/',
            Text: 'OpenAI Platform - Build with the OpenAI API',
          },
        ],
        RelatedTopics: [
          {
            FirstURL: 'https://chatgpt.com/',
            Text: 'ChatGPT - AI assistant for conversations',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeTool('agent-1', 'task-1', 'web_search', {
      query: 'OpenAI platform',
      max_results: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      query: 'OpenAI platform',
      engine: 'duckduckgo',
      results: [
        {
          title: 'OpenAI',
          url: 'https://openai.com/',
          source: 'duckduckgo-abstract',
        },
        {
          title: 'OpenAI Platform',
          url: 'https://platform.openai.com/',
          source: 'duckduckgo-results',
        },
      ],
    });

    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain('INSERT INTO tool_calls');
    expect(dbMock.query.mock.calls[1]?.[1]?.[5]).toBe('success');
  });

  it('writes files only inside the workspace and returns byte metadata', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-2',
            name: 'file_write',
            type: 'builtin',
            company_id: 'company-1',
            config: {},
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await executeTool('agent-1', 'task-1', 'file_write', {
      path: 'tmp-test-artifacts/generated/note.txt',
      content: 'hello workspace',
    });

    expect(result).toEqual({
      ok: true,
      path: 'tmp-test-artifacts\\generated\\note.txt',
      bytes_written: 15,
    });

    const persisted = await readFile(path.join(workspaceDir, 'generated', 'note.txt'), 'utf8');
    expect(persisted).toBe('hello workspace');
    expect(dbMock.query.mock.calls[1]?.[1]?.[5]).toBe('success');
  });

  it('runs bash tools through the sandbox runner and logs successful output', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-3',
            name: 'shell_utils',
            type: 'bash',
            company_id: 'company-1',
            config: {
              allowed_commands: ['git status', 'pwd'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    runSandboxedBashCommandMock.mockResolvedValue('On branch main');

    const result = await executeTool('agent-1', 'task-1', 'shell_utils', {
      command: 'git status --short',
    });

    expect(runSandboxedBashCommandMock).toHaveBeenCalledWith('git status --short', {
      allowed_commands: ['git status', 'pwd'],
    });
    expect(result).toBe('On branch main');
    expect(dbMock.query.mock.calls[1]?.[1]?.[5]).toBe('success');
  });

  it('blocks unsafe bash chaining even when the base command is whitelisted', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-4',
            name: 'shell_utils',
            type: 'bash',
            company_id: 'company-1',
            config: {
              allowed_commands: ['git status'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await executeTool('agent-1', 'task-1', 'shell_utils', {
      command: 'git status && whoami',
    });

    expect(runSandboxedBashCommandMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: 'Unsafe shell control operators are not allowed',
    });
    expect(dbMock.query.mock.calls[1]?.[1]?.[5]).toBe('error');
  });
});
