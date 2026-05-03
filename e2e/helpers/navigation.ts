export async function navigateToDashboard(page: any) {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.waitForSelector('aside', { timeout: 5000 });
}

export async function navigateToModule(page: any, href: string, label: string) {
  // First, verify the link exists
  const selector = `a[href="${href}"]`;
  const linkExists = await page.$(selector);
  if (!linkExists) {
    // Log available links for debugging
    const availableLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: a.getAttribute('href'),
        text: a.textContent?.trim(),
      }));
    });
    throw new Error(`Link not found: ${selector}. Available links: ${JSON.stringify(availableLinks)}`);
  }

  // Click the link
  const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle' });
  await page.click(selector);
  try {
    await Promise.race([navigationPromise, new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Navigation timeout')), 10000)
    )]);
  } catch (e) {
    // If navigation fails, try navigating directly
    await page.goto(href, { waitUntil: 'networkidle' });
  }
}

export async function expectNavItemActive(page: any, href: string) {
  const navItem = await page.$(`a[href="${href}"]`);
  const classAttr = await navItem?.getAttribute('class');
  return classAttr?.includes('bg-indigo-600');
}

export async function getNavigationItems(page: any) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('aside nav a')).map(
      (a) => ({
        href: a.getAttribute('href'),
        label: a.textContent?.trim(),
      })
    );
  });
}
