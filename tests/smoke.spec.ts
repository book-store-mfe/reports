import { test, expect } from '@playwright/test';
import { describe } from 'node:test';

const baseUrl = 'https://book-store-mfe.github.io/store/#/';

test.describe('Store MFE smoke', () => {

  test('sign up', async ({ page }) => {
    await page.goto(`${baseUrl}login`);

    await page.getByRole('button', { name: 'Criar conta' }).click()
    await page.locator('input[formcontrolname="name"]').fill('Jhon');
    await page.locator('input[formcontrolname="email"]').fill('jhon@gmail.com');
    await page.getByRole('button', { name: 'Cadastro' }).click()

    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: 'Bookstore' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'catalog' })).toBeVisible();
  });

  test.describe('navigation', () => {

    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}login`, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        const user = { name: 'Jhon', email: 'jhon@gmail.com', token: 'xxxx', }
        localStorage.setItem("shared-lib-auth", JSON.stringify(user))
      })
      await page.goto(`${baseUrl}`);
      await page.reload();
    });

    test('should render catalog', async ({ page }) => {
      await page.getByRole('button', { name: 'catalog' }).click();
      await expect(page.locator('mat-card')).toHaveCount(4);
    });

    test('should render account', async ({ page }) => {
      await page.getByRole('button', { name: 'account' }).click();

      await expect(page.locator('input[formcontrolname="name"]')).toHaveValue('Jhonx');
      await expect(page.locator('input[formcontrolname="email"]')).toHaveValue('jhon@gmail.com');
    });

  })

});
