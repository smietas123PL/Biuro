import { test, expect } from '@playwright/test';
test('explicit login test', async ({ page }) => {
  const email = `test_login_${Date.now()}@example.com`;
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill('password123');
  await page.locator('#register-company-name').fill('Login Inc');
  await page.locator('section').nth(1).getByRole('button', { name: 'Create account' }).last().click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15000 });
  
  await page.goto('/auth');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill('password123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15000 });
});
