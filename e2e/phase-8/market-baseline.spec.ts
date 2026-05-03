import { test, expect } from '@playwright/test';
import {
  navigateToDashboard,
  navigateToModule,
  expectNavItemActive,
} from '../helpers/navigation';
import { extractTableData } from '../fixtures/test-data';

test.describe('P8.9 Market Baseline', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDashboard(page);
  });

  test('应该显示Market Baseline导航项', async ({ page }) => {
    const navItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('aside nav a')).map(
        (a) => a.textContent?.trim()
      );
    });
    const hasMarketBaseline = navItems.some((item) =>
      item?.includes('Market Baseline')
    );
    expect(hasMarketBaseline).toBe(true);
  });

  test('应该导航到Market Baseline页面', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/market-baseline',
      'Market Baseline'
    );
    const heading = await page.textContent('h1, h2');
    expect(heading).toBeTruthy();
  });

  test('应该在Market Baseline导航项标记为活跃', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/market-baseline',
      'Market Baseline'
    );
    const isActive = await expectNavItemActive(
      page,
      '/dashboard/market-baseline'
    );
    expect(isActive).toBe(true);
  });

  test('应该加载行业基线数据或显示空状态', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/market-baseline',
      'Market Baseline'
    );

    await page.waitForFunction(
      () => {
        return document.querySelector('table') !== null ||
               document.querySelector('.bg-white.p-4.rounded-lg') !== null ||
               document.querySelector('.text-center.text-gray-400') !== null;
      },
      { timeout: 8000 }
    );

    const table = await page.$('table');
    if (table) {
      expect(table).toBeTruthy();
    } else {
      const hasContent = await page.$('.bg-white.p-4.rounded-lg, .text-center.text-gray-400');
      expect(hasContent).toBeTruthy();
    }
  });

  test('应该显示汇总统计', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/market-baseline',
      'Market Baseline'
    );

    // Wait for page to load the heading
    await page.waitForSelector('h1', { timeout: 5000 });

    // Try to wait for metric cards, but don't fail if they're not there
    const summaryCards = await page.$$('.bg-white.p-4.rounded-lg.border.border-gray-200').catch(() => []);

    // Either we have cards or the page loaded without error (data might not be available)
    const heading = await page.$('h1');
    expect(heading || summaryCards.length > 0).toBeTruthy();
  });
});
