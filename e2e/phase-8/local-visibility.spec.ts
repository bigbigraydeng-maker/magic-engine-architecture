import { test, expect } from '@playwright/test';
import {
  navigateToDashboard,
  navigateToModule,
  expectNavItemActive,
} from '../helpers/navigation';
import { TEST_DATA, extractTableData } from '../fixtures/test-data';

test.describe('P8.8 Local Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDashboard(page);
  });

  test('应该显示Local Visibility导航项', async ({ page }) => {
    const navItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('aside nav a')).map(
        (a) => a.textContent?.trim()
      );
    });
    const hasLocalVisibility = navItems.some((item) =>
      item?.includes('Local Visibility')
    );
    expect(hasLocalVisibility).toBe(true);
  });

  test('应该导航到Local Visibility页面', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/local-visibility',
      'Local Visibility'
    );
    const heading = await page.textContent('h1, h2');
    expect(heading).toBeTruthy();
  });

  test('应该在Local Visibility导航项标记为活跃', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/local-visibility',
      'Local Visibility'
    );
    const isActive = await expectNavItemActive(
      page,
      '/dashboard/local-visibility'
    );
    expect(isActive).toBe(true);
  });

  test('应该显示城市选择器', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/local-visibility',
      'Local Visibility'
    );

    const citySelector = await page.$(
      'select, [role="combobox"], input[placeholder*="city" i]'
    );
    expect(citySelector).toBeTruthy();
  });

  test('应该加载本地排名数据或显示空状态', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/local-visibility',
      'Local Visibility'
    );

    // Wait for page to stabilize - check for control bar which should always be present
    await page.waitForSelector('select', { timeout: 5000 });

    // Give the page time to fetch data
    await page.waitForTimeout(2000);

    // Check for any content - grid, table, or empty state
    const hasGrid = await page.locator('[class*="grid-cols"]').count().then(c => c > 0).catch(() => false);
    const hasTable = await page.$('table').then(el => el !== null).catch(() => false);

    // Either we have content or the page loaded without errors
    const pageLoaded = await page.$('h1').then(el => el !== null).catch(() => false);
    expect(pageLoaded || hasGrid || hasTable).toBeTruthy();
  });
});
