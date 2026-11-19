// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';

import { createApp, defineComponent, h, nextTick } from 'vue';

import { globalShareState } from '@vben/common-ui';

import { describe, expect, it, vi } from 'vitest';

import { initComponentAdapter } from '#/adapter/component';
import { overridesPreferences } from '#/preferences';

const repoRoot = path.resolve(import.meta.dirname, '../../../../');

describe('layout and shell safeguards', () => {
  it('disables the unguarded header refresh widget and avoids unmounting active views on locale or timezone updates', () => {
    expect(overridesPreferences.widget?.refresh).toBe(false);

    const layoutSource = fs.readFileSync(
      path.join(repoRoot, 'packages/effects/layouts/src/basic/layout.vue'),
      'utf8',
    );
    expect(layoutSource).not.toMatch(/watch\(\s*i18n\.global\.locale\s*,\s*refresh/);
    expect(layoutSource).not.toMatch(/\brefresh\(\)/);
  });

  it('uses bundled icons with accessible labels for sidebar and theme controls without external iconify calls', () => {
    const vbenLayout = fs.readFileSync(
      path.join(
        repoRoot,
        'packages/@core/ui-kit/layout-ui/src/vben-layout.vue',
      ),
      'utf8',
    );
    expect(vbenLayout).not.toContain('IconifyIcon');
    expect(vbenLayout).not.toContain('ep:fold');
    expect(vbenLayout).not.toContain('ep:expand');
    expect(vbenLayout).toMatch(/showHeaderToggleButton[\s\S]{0,200}:aria-label=/);

    const header = fs.readFileSync(
      path.join(
        repoRoot,
        'packages/effects/layouts/src/basic/header/header.vue',
      ),
      'utf8',
    );
    // theme-toggle must not be gated behind preferencesButtonPosition.value.header when enablePreferences is false.
    const prefsBlock =
      /if\s*\(\s*preferencesButtonPosition\.value\.header\s*\)\s*\{([\s\S]*?)\n\s*\}/.exec(
        header,
      )?.[1] ?? '';
    expect(prefsBlock).not.toContain("'theme-toggle'");
    expect(header).toContain("'theme-toggle'");
  });

  it('spreads attrs onto DefaultButton and PrimaryButton instead of passing a nested attrs prop', async () => {
    await initComponentAdapter();
    const components = globalShareState.getComponents();
    const DefaultButton = components.DefaultButton;
    const PrimaryButton = components.PrimaryButton;
    expect(DefaultButton).toBeDefined();
    expect(PrimaryButton).toBeDefined();

    const Host = defineComponent({
      setup() {
        return () =>
          h('div', [
            h(
              DefaultButton!,
              { 'aria-label': 'custom-default', 'data-testid': 'btn-default' },
              () => 'Default',
            ),
            h(
              PrimaryButton!,
              { 'aria-label': 'custom-primary', 'data-testid': 'btn-primary' },
              () => 'Primary',
            ),
          ]);
      },
    });
    const container = document.createElement('div');
    const app = createApp(Host);
    app.mount(container);
    try {
      await vi.dynamicImportSettled();
      await nextTick();
      const buttons = container.querySelectorAll('button');
      expect(buttons).toHaveLength(2);
      expect(buttons[0]?.getAttribute('aria-label')).toBe('custom-default');
      expect(buttons[1]?.getAttribute('aria-label')).toBe('custom-primary');
      expect(buttons[0]?.getAttribute('attrs')).toBeNull();
      expect(buttons[1]?.getAttribute('attrs')).toBeNull();
    } finally {
      app.unmount();
    }
  });
});
