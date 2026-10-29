import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { expect, test } from 'playwright/test';

import { fixture, routes } from './resource-fixture.mjs';
async function setup(page, info) {
  const errors = [];
    const locale = info.project.metadata.locale;
    const m = JSON.parse(
      fs.readFileSync(
        `apps/web-antd/src/locales/langs/${locale}/page.json`,
        'utf8',
      ),
    ).resources;
    const s = fixture();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (/\[intlify\].*(Not found|Fall back)/i.test(e.text()))
      errors.push(e.text());
  });
  await routes(page, s);
  await page.goto(`http://127.0.0.1:18786/resources?lang=${locale}`);
  await expect(
    page.getByRole('button', { name: m.taxonomy, exact: true }),
  ).toBeVisible();
  return { m, s, errors, locale };
}
async function layout(page, errors, locale) {
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    locale === 'ar-EG' ? 'rtl' : 'ltr',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
if(process.env.RESOURCE_SCREENSHOTS && ((locale==='zh-CN'&&page.viewportSize().width>800)||(locale==='ar-EG'&&page.viewportSize().width<800))&&test.info().title.startsWith('category')){fs.mkdirSync(process.env.RESOURCE_SCREENSHOTS,{recursive:true});await page.locator('.resources-page nav').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.RESOURCE_SCREENSHOTS,'admin-'+locale+'.png'),fullPage:true})} 
}
test('category configuration preserves stable ids, fields and original-request retry', async ({
  page,
}, info) => {
  const { m, s, errors, locale } = await setup(page, info);
  await page.getByRole('button', { name: m.taxonomy, exact: true }).click();
  await page.getByRole('button', { name: m.edit, exact: true }).click();
  const group = page.getByRole('group', { name: m.names, exact: true }).first();
  await group.getByLabel('zh-CN', { exact: true }).fill('按配置更名');
  s.lose = true;
  await page.getByRole('button', { name: m.save, exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .locator('button[type=submit]')
    .filter({ hasText: m.retry })
    .click();
  await expect
    .poll(
      () =>
        s.calls.filter(
          (x) => x.method === 'PUT' && x.path.startsWith('/categories/'),
        ).length,
    )
    .toBe(2);
  const writes = s.calls.filter(
    (x) => x.method === 'PUT' && x.path.startsWith('/categories/'),
  );
  expect(writes[0].key).toBe(writes[1].key);
  expect(writes[0].body).toEqual(writes[1].body);
  expect(s.category.id).toBe('custom-category');
  expect(s.category.names['zh-CN']).toBe('按配置更名');
  expect(s.category.group_by).toBe('edition');
  expect(s.category.fields[0].kind).toBe('integer');
  await layout(page, errors, locale);
});
test('grant creation and revocation retain the subject and respect current permissions', async ({
  page,
}, info) => {
  const { m, s, errors, locale } = await setup(page, info);
  await page
    .getByRole('combobox', { name: m.catalog.school, exact: true })
    .selectOption('school');
  await page.getByRole('button', { name: m.view, exact: true }).click();
  await page.getByLabel(m.subjectKey, { exact: true }).fill('issuer:reader');
  await page.getByRole('button', { name: m.grant, exact: true }).click();
  await expect(page.getByText('issuer:reader', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.revoke, exact: true }).click();
  await expect(page.getByText(m.revoked, { exact: true })).toBeVisible();
  const grants = s.calls.filter((x) => x.path.includes('/grants/'));
  expect(grants).toHaveLength(2);
  expect(grants[1].body).toMatchObject({
    subject_key: 'issuer:reader',
    revoked: true,
    revision: 1,
  });
  s.reject = true;
  await page.getByRole('button', { name: m.filter, exact: true }).click();
  await expect(
    page.getByText(m.errors.permission_denied, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('issuer:reader', { exact: true })).toHaveCount(0);
  await layout(page, errors, locale);
});
test('review reads the pending file and retries an unknown decision without duplication', async ({
  page,
}, info) => {
  const { m, s, errors, locale } = await setup(page, info);
  await page
    .getByRole('combobox', { name: m.catalog.school, exact: true })
    .selectOption('school');
  await page.getByRole('button', { name: m.reviewQueue, exact: true }).click();
  await page.getByRole('button', { name: m.view, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Fixture notes', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: m.download, exact: true }).click();
  await expect
    .poll(() => s.calls.filter((x) => x.path === '/review/version/file').length)
    .toBe(1);
  await page
    .getByLabel(m.reason, { exact: true })
    .fill('Verified content and source');
  s.lose = true;
  await page.getByRole('button', { name: m.confirm, exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .locator('button[type=submit]')
    .filter({ hasText: m.retry })
    .click();
  await expect
    .poll(() => s.calls.filter((x) => x.path.endsWith('/decisions')).length)
    .toBe(2);
  const decisions = s.calls.filter((x) => x.path.endsWith('/decisions'));
  expect(decisions[0].key).toBe(decisions[1].key);
  expect(decisions[0].body).toEqual(decisions[1].body);
  expect(decisions[0].body.decision).toMatchObject({
    object_id: 'resource:version',
    revision: 2,
    action: 'publish',
  });
  await page.getByRole('button', { name: m.reload, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: m.states.applied }),
  ).toBeVisible();
  await layout(page, errors, locale);
});
test('directory editing saves revision and configured names', async ({
  page,
}, info) => {
  const { m, s, errors, locale } = await setup(page, info);
  await page
    .getByRole('combobox', { name: m.catalog.school, exact: true })
    .selectOption('school');
  await page.getByRole('button', { name: m.directories, exact: true }).click();
  await page.getByRole('button', { name: m.edit, exact: true }).click();
  await page
    .getByRole('group', { name: m.names, exact: true })
    .getByLabel('zh-CN', { exact: true })
    .fill('更名后的目录');
  await page.getByRole('button', { name: m.save, exact: true }).click();
  await expect.poll(() => s.directory.names['zh-CN']).toBe('更名后的目录');
  expect(s.directory.id).toBe('folder');
  expect(s.directory.revision).toBe(2);
  await layout(page, errors, locale);
});

test('owned file reuse avoids content transfer and keeps separate review',async({page},info)=>{
 const {m,s,errors,locale}=await setup(page,info);await page.goto(`http://127.0.0.1:18786/resources/new?school_id=school&course_id=course&lang=${locale}`);
 await page.getByLabel(m.resourceTitle,{exact:true}).fill('Reused lecture');await page.getByRole('combobox',{name:m.origin,exact:true}).selectOption('original');await page.getByLabel(m.acceptTerms,{exact:true}).check();await page.getByRole('button',{name:m.save,exact:true}).click();await expect(page.getByText(m.saved,{exact:true})).toBeVisible();
 s.media.reused=true;s.media.state='verifying';await page.getByLabel(m.chooseFile,{exact:true}).setInputFiles({name:'lecture.txt',mimeType:'text/plain',buffer:Buffer.from('hello')});await page.getByRole('button',{name:m.uploadFile,exact:true}).click();await expect(page.getByText(m.errors.reuse_pending,{exact:true})).toBeVisible();
 expect(s.calls.filter(x=>x.path?.startsWith('/api/v1/media')&&x.method==='PUT')).toHaveLength(0);s.media.state='awaiting_approval';await page.getByRole('button',{name:m.uploadFile,exact:true}).click();await expect(page.getByText(m.reusedFile,{exact:true})).toBeVisible();await expect(page.getByText(m.uploadStates.attached,{exact:true})).toBeVisible();expect(s.calls.filter(x=>x.path==='/api/v1/media/uploads')).toHaveLength(1);expect(s.calls.find(x=>x.path==='/api/v1/media/uploads').body.reuse_existing).toBe(true);expect(s.calls.filter(x=>x.path?.startsWith('/api/v1/media')&&x.method==='PUT')).toHaveLength(0);await page.getByRole('button',{name:m.submit,exact:true}).click();await expect(page.getByText(m.states.pending,{exact:true})).toBeVisible();await layout(page,errors,locale);
});
