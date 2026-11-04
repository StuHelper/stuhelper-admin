import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

import page from '#/locales/langs/zh-CN/page.json';
import { adminMenus, availableSettings, plannedSettings } from '#/navigation';

const router = readFileSync('apps/web-antd/src/router/index.ts', 'utf8');

it('links every menu leaf and available setting to a registered page', () => {
  const leaves = adminMenus.flatMap((item) => item.children ?? [item]).map((item) => item.path);
  for (const path of [...leaves, ...availableSettings.map((item) => item.path)]) {
    const route = path === '/' ? "path: ''" : path.replace(/^\//, '');
    expect(router, path).toContain(route);
  }
});

it('keeps available and planned settings separate and fully described', () => {
  const items = page.settings.items as Record<string, { summary: string; title: string }>;
  const available = availableSettings.map((item) => item.key);
  expect(available.filter((key) => plannedSettings.includes(key))).toEqual([]);
  for (const key of [...available, ...plannedSettings]) {
    expect(items[key]?.title, key).toBeTruthy();
    expect(items[key]?.summary, key).toBeTruthy();
  }
});
