import { createApp, h, nextTick, ref, type VNode } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import MaterialPreview from './MaterialPreview.vue';
import ReasonPresets from './ReasonPresets.vue';

vi.mock('@vben/locales', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});

async function settle() {
  await Promise.resolve();
  await nextTick();
}

function mountRender(view: () => VNode) {
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp({ render: view });
  app.mount(root);
  cleanups.push(() => {
    app.unmount();
    root.remove();
  });
  return root;
}

describe('MaterialPreview', () => {
  it('renders a sandboxed PDF iframe within limit and warns when oversized', async () => {
    const tooLarge = ref(false);
    const root = mountRender(() =>
      h(MaterialPreview, {
        contentType: 'application/pdf',
        label: 'syllabus.pdf',
        tooLarge: tooLarge.value,
        url: 'blob:test-pdf',
      }),
    );
    await settle();

    const frame = root.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('src')).toBe('blob:test-pdf');

    tooLarge.value = true;
    await settle();
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.textContent).toContain('page.resources.previewTooLarge');
  });

  it('rotates, zooms and resets image previews', async () => {
    const root = mountRender(() =>
      h(MaterialPreview, {
        contentType: 'image/png',
        label: 'card.png',
        url: 'blob:test-img',
      }),
    );
    await settle();

    const img = root.querySelector('img');
    expect(img?.style.transform).toBe('rotate(0deg) scale(1)');

    const buttonOf = (text: string) =>
      [...root.querySelectorAll('button')].find((button) =>
        button.textContent?.includes(text),
      );
    buttonOf('page.resources.rotateRight')?.click();
    await settle();
    expect(img?.style.transform).toBe('rotate(90deg) scale(1)');

    buttonOf('page.resources.zoomIn')?.click();
    await settle();
    expect(img?.style.transform).toBe('rotate(90deg) scale(1.25)');

    buttonOf('page.resources.resetView')?.click();
    await settle();
    expect(img?.style.transform).toBe('rotate(0deg) scale(1)');
  });
});

describe('ReasonPresets', () => {
  it('fills an empty note and appends distinct presets without duplicating', async () => {
    const value = ref('');
    const root = mountRender(() =>
      h(ReasonPresets, {
        modelValue: value.value,
        'onUpdate:modelValue': (next: string) => {
          value.value = next;
        },
        presets: [
          { key: 'a', text: 'First template.' },
          { key: 'b', text: 'Second template.' },
        ],
      }),
    );
    await settle();

    const buttons = [...root.querySelectorAll('button')];
    buttons[0]?.click();
    await settle();
    expect(value.value).toBe('First template.');

    buttons[0]?.click();
    await settle();
    expect(value.value).toBe('First template.');

    buttons[1]?.click();
    await settle();
    expect(value.value).toBe('First template. Second template.');
  });

  it('adds a complete preset that fits the code-point limit and preserves an oversized draft', async () => {
    const value = ref('😀');
    const root = mountRender(() =>
      h(ReasonPresets, {
        countCodePoints: true,
        maxLength: 3,
        modelValue: value.value,
        'onUpdate:modelValue': (next: string) => {
          value.value = next;
        },
        presets: [{ key: 'A', text: '😀' }, { key: 'B', text: '😃' }],
      }),
    );
    await settle();

    const buttons = [...root.querySelectorAll('button')];
    buttons[1]?.click();
    await settle();
    expect(value.value).toBe('😀 😃');

    value.value = '😀😀😀😀';
    await settle();
    buttons[1]?.click();
    await settle();
    expect(value.value).toBe('😀😀😀😀');
  });
});
