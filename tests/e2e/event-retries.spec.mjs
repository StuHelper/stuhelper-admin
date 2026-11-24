import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';

test('only an explicitly authorized session can requeue the observed delivery', async ({ page }, info) => {
  const locale = info.project.metadata.locale;
  const labels = JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${locale}/page.json`, 'utf8'));
  const url = `http://127.0.0.1:18786/system/event-retries?lang=${locale}`;
  const delivery = { id: 'synthetic-delivery', attempts: 2, first_failure: '2026-10-01T08:00:00Z', last_error_code: 'timeout' };
  const requests = [];
  let reads = 0;
  await page.route('**/api/v1/admin/event-retries**', async (route) => {
    if (route.request().method() === 'GET') {
      reads++;
      return route.fulfill({ json: { items: requests.length > 0 ? [] : [delivery] } });
    }
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });

  await schoolSession(page);
  await page.goto(url);
  await expect(page.getByText(labels.errors.forbidden, { exact: true }).first()).toBeVisible();
  expect(reads).toBe(0);

  await schoolSession(page, 'school', false, true);
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: delivery.id });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: labels.common.retry }).click();
  await expect(page.getByText(labels.eventRetries.queued, { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(requests).toEqual([{ source: 'reviews', id: delivery.id, first_failure: delivery.first_failure }]);
});
