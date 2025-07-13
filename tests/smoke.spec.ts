import { test, expect } from '@playwright/test';

const baseUrl = 'https://book-store-mfe.github.io/store/#/';

test.describe('Store MFE smoke', () => {

  test('sign navigation', async ({ page }) => {
    await page.goto(`${baseUrl}login`);

    await page.getByRole('button', { name: 'Criar conta' }).click()
    await page.locator('input[formcontrolname="name"]').fill('Jhon');
    await page.locator('input[formcontrolname="email"]').fill('jhon@gmail.com');
    await page.getByRole('button', { name: 'Cadastro' }).click()

    await expect(page.getByRole('button', { name: 'Bookstore' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'catalog' })).toBeVisible();
  });

  //test('should load login page', async ({ page }) => {
  //  await page.goto(`${baseUrl}login`, { waitUntil: 'networkidle' });
  //  page.waitForLoadState('domcontentloaded')
  //  await page.waitForLoadState('networkidle');
  //  await page.evaluate(() => {
  //    const user = {
  //      name: 'Jhon',
  //      email: 'jhon@gmail.com',
  //      token: 'xxxx',
  //    }
  //    localStorage.setItem("shared-lib-auth", JSON.stringify(user))

  //    console.log('local storage', localStorage.getItem('shared-lib-auth'))
  //  })
  //  await page.goto(`${baseUrl}catalog`, { waitUntil: 'networkidle' });
  //  await page.reload(); // router hash not refresh
  //  await page.waitForLoadState('networkidle');
  //  await expect(page.getByRole('button', { name: 'Bookstore' })).toBeVisible();
  //  await expect(page.getByRole('button', { name: 'account' })).toBeVisible();
  //  await expect(page.getByRole('button', { name: 'catalog' })).toBeVisible();
  //});

});
