export type ToolType = 'builtin' | 'http' | 'bash' | 'mcp';

export type DefaultToolBlueprint = {
  name: string;
  description: string;
  type: ToolType;
  config: Record<string, unknown>;
};

export const DEFAULT_TOOL_BLUEPRINTS: DefaultToolBlueprint[] = [
  {
    name: 'web_search',
    description: 'Search current public information with DuckDuckGo instant answers.',
    type: 'builtin',
    config: {
      builtin: 'web_search',
      example_params: {
        query: 'latest competitor news',
        max_results: 5,
      },
    },
  },
  {
    name: 'file_write',
    description: 'Write text files inside the workspace with path safety checks.',
    type: 'builtin',
    config: {
      builtin: 'file_write',
      example_params: {
        path: 'notes/summary.md',
        content: '# Launch summary',
      },
    },
  },
  {
    name: 'webhook_notify',
    description: 'Send JSON notifications to an approved webhook endpoint.',
    type: 'http',
    config: {
      url: 'https://example.com/webhook',
      method: 'POST',
      headers: {
        'X-Biuro-Source': 'tools',
      },
    },
  },
  {
    name: 'internal_api',
    description: 'Call an internal JSON API endpoint with shared auth headers.',
    type: 'http',
    config: {
      url: 'https://api.internal.example.com/v1/action',
      method: 'POST',
      headers: {
        Authorization: 'Bearer replace-me',
      },
    },
  },
  {
    name: 'shell_utils',
    description: 'Run a tightly whitelisted shell command inside an isolated sandbox.',
    type: 'bash',
    config: {
      allowed_commands: ['git status', 'ls', 'pwd'],
    },
  },
];
