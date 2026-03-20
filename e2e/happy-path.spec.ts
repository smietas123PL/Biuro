import { expect, test, type Page } from '@playwright/test';

async function dismissOnboardingIfVisible(page: Page) {
  const skipButton = page.getByRole('button', { name: /Pomiń/i });
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click();
  }
}

test('new operator can hire an agent, assign a task, and watch it complete', async ({
  page,
}) => {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `playwright-${uniqueId}@example.com`;
  const companyName = `Playwright Labs ${uniqueId}`;
  const agentName = `Agent ${uniqueId}`;
  const taskTitle = `Happy path task ${uniqueId}`;

  await page.goto('/auth');
  await expect(
    page.getByRole('heading', { name: 'Sign in to run the company.' })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#register-full-name').fill('Playwright Operator');
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill('password123');
  await page.locator('#register-company-name').fill(companyName);
  await page
    .locator('#register-company-mission')
    .fill('Verify the real-time happy path for new teams.');
  await page
    .locator('section')
    .nth(1)
    .getByRole('button', { name: 'Create account' })
    .last()
    .click();

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({
    timeout: 30_000,
  });
  await dismissOnboardingIfVisible(page);
  await expect(page.locator('#company-select')).not.toHaveValue('');

  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Agents', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await page.getByRole('button', { name: 'Hire Agent' }).click();
  await page.locator('#agent-name').fill(agentName);
  await page.locator('#agent-role').fill('operator');
  await page.locator('#agent-title').fill('Realtime Operator');
  await page
    .locator('[data-onboarding-target="agents-hire-modal"]')
    .getByRole('button', { name: 'Hire Agent' })
    .click();
  await expect(page.getByRole('link', { name: agentName }).first()).toBeVisible({
    timeout: 15_000,
  });

  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Tasks', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await page.getByRole('button', { name: 'Create Task' }).click();
  await page.locator('#task-title').fill(taskTitle);
  await page
    .locator('#task-description')
    .fill('This task should complete through the worker and update the UI.');
  await page.locator('#task-assigned-to').selectOption({ label: agentName });
  await page.locator('#task-priority').fill('25');
  await page
    .locator('[data-onboarding-target="tasks-create-modal"]')
    .getByRole('button', { name: 'Create Task' })
    .click();

  const taskCard = page
    .locator('[data-testid^="task-card-"]')
    .filter({ hasText: taskTitle })
    .first();
  const taskStatus = taskCard.locator('[data-testid^="task-status-"]').first();

  await expect(taskCard).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () => (await taskStatus.textContent())?.trim().toLowerCase() ?? '',
      {
        timeout: 45_000,
        message:
          'Task status should reach done via realtime UI refresh from worker events.',
      }
    )
    .toBe('done');
});
