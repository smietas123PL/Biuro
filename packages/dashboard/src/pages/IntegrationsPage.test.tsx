import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsPage from './IntegrationsPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

const overviewResponse = {
  base_url: 'https://biuro.test',
  slack: {
    configured: true,
    signing_secret_configured: true,
    events_url: 'https://biuro.test/api/integrations/slack/events',
    slash_command_url: 'https://biuro.test/api/integrations/slack/command',
    interactions_url: 'https://biuro.test/api/integrations/slack/interactions',
    approval_actions: {
      ready: true,
      status: 'Ready for one-click approvals',
      requirements: [
        {
          label:
            'Interactivity endpoint exposed at https://biuro.test/api/integrations/slack/interactions',
          met: true,
        },
        {
          label: 'SLACK_SIGNING_SECRET configured on the server',
          met: true,
        },
        {
          label: 'Outgoing Slack webhook saved for this company',
          met: true,
        },
      ],
    },
    slash_command_name: '/biuro',
    example_payload: {
      command: '/biuro',
      text: 'approve task-1',
      company_id: 'company-1',
    },
  },
  discord: {
    configured: false,
    webhook_secret_configured: false,
    webhook_url: 'https://biuro.test/api/integrations/discord/webhook',
    expected_header: 'x-biuro-discord-secret',
  },
  outgoing: {
    slack_webhook_url: 'https://hooks.slack.test/services/original',
    discord_webhook_url: null,
  },
  webhook_tests: {
    last_test: {
      type: 'slack' as const,
      status: 'success' as const,
      created_at: '2026-03-18T20:00:00.000Z',
      target_url: 'https://hooks.slack.test/services/original',
      error: null,
    },
    recent: [
      {
        id: 'test-1',
        type: 'slack' as const,
        status: 'success' as const,
        created_at: '2026-03-18T20:00:00.000Z',
        target_url: 'https://hooks.slack.test/services/original',
        error: null,
      },
    ],
  },
};

describe('IntegrationsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
    });
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'QA Test Corp' },
      selectedCompanyId: 'company-1',
    });
  });

  it('loads the overview and lets the user save and test outgoing webhooks', async () => {
    requestMock
      .mockResolvedValueOnce(overviewResponse)
      .mockResolvedValueOnce({
        outgoing: {
          slack_webhook_url: 'https://hooks.slack.test/services/updated',
          discord_webhook_url: 'https://discord.test/api/webhooks/new',
        },
      })
      .mockResolvedValueOnce({ ok: true });

    render(<IntegrationsPage />);

    await waitFor(() => {
      expect(requestMock).toHaveBeenNthCalledWith(
        1,
        '/integrations/overview',
        undefined,
        { suppressError: true }
      );
    });

    await waitFor(() => {
      expect(screen.getAllByRole('textbox').length).toBe(2);
    });

    const textareas = screen.getAllByRole('textbox');
    fireEvent.change(textareas[0], {
      target: { value: 'https://hooks.slack.test/services/updated' },
    });
    fireEvent.change(textareas[1], {
      target: { value: 'https://discord.test/api/webhooks/new' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenNthCalledWith(2, '/integrations/config', {
        method: 'PATCH',
        body: JSON.stringify({
          slack_webhook_url: 'https://hooks.slack.test/services/updated',
          discord_webhook_url: 'https://discord.test/api/webhooks/new',
        }),
      });
    });

    expect(
      screen.getByText('Webhook settings saved for this company.')
    ).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Send test' })[1]);

    await waitFor(() => {
      expect(requestMock).toHaveBeenNthCalledWith(
        3,
        '/integrations/test-webhook',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'discord',
            url: 'https://discord.test/api/webhooks/new',
          }),
        }
      );
    });

    expect(
      screen.getByText('Discord test message sent successfully.')
    ).toBeTruthy();
    expect(screen.getByText('https://biuro.test')).toBeTruthy();
    expect(
      screen.getAllByText('https://hooks.slack.test/services/original')
    ).toHaveLength(2);
    expect(
      screen.getByText('https://biuro.test/api/integrations/slack/interactions')
    ).toBeTruthy();
    expect(
      screen.getAllByText('Ready for one-click approvals').length
    ).toBeGreaterThan(0);
    expect(screen.getByText('Slack One-Click Approvals')).toBeTruthy();
    expect(
      screen.getByText('Outgoing Slack webhook saved for this company')
    ).toBeTruthy();
  });
});
