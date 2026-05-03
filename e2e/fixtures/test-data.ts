export const TEST_DATA = {
  clients: {
    primary: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test Client One',
      domain: 'example.com',
    },
  },
  keywords: {
    seo: ['digital marketing', 'seo services', 'content marketing'],
    local: ['restaurants near me', 'plumbers sydney', 'dentist melbourne'],
  },
  months: {
    current: new Date().toISOString().slice(0, 7),
    previous: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 7),
  },
};

export async function waitForData(page: any, selector: string, timeout = 5000) {
  return page.waitForSelector(selector, { timeout });
}

export async function expectTableRowCount(
  page: any,
  minRows: number,
  timeout = 5000
) {
  await page.waitForFunction(
    (min: number) => {
      const rows = document.querySelectorAll('tbody tr');
      return rows.length >= min;
    },
    minRows,
    { timeout }
  );
}

export async function extractTableData(page: any) {
  return page.evaluate(() => {
    const headers = Array.from(
      document.querySelectorAll('thead th')
    ).map((th) => th.textContent?.trim());

    const rows = Array.from(document.querySelectorAll('tbody tr')).map(
      (tr) => {
        return Array.from(tr.querySelectorAll('td')).map((td) =>
          td.textContent?.trim()
        );
      }
    );

    return { headers, rows };
  });
}
