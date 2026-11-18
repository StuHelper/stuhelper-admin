// @vitest-environment happy-dom
import type { FunctionalComponent } from 'vue';

import { createApp, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionStore, sessionKey } from '#/shared/session';

import SessionControls from './SessionControls.vue';

vi.mock('@vben/locales', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true }),
}));

vi.mock('ant-design-vue', () => {
  const Alert: FunctionalComponent<{ message?: string }> = (props) =>
    h('div', { role: 'alert' }, props.message ?? '');
  const Button: FunctionalComponent<{ disabled?: boolean }> = (
    props,
    { attrs, emit, slots },
  ) =>
    h(
      'button',
      {
        ...attrs,
        disabled: Boolean(props.disabled),
        onClick: () => emit('click'),
      },
      slots.default?.(),
    );
  const Dropdown: FunctionalComponent = (_props, { slots }) =>
    h('div', [slots.default?.(), slots.overlay?.()]);
  const Form: FunctionalComponent = (_props, { attrs, slots }) =>
    h('form', attrs, slots.default?.());
  const FormItem: FunctionalComponent = (_props, { attrs, slots }) =>
    h('div', attrs, slots.default?.());
  const Input: FunctionalComponent<{
    disabled?: boolean;
    maxlength?: number;
    value?: string;
  }> = (props, { attrs, emit }) =>
    h('input', {
      ...attrs,
      disabled: Boolean(props.disabled),
      maxLength: props.maxlength,
      value: props.value ?? '',
      onInput: (event: Event) =>
        emit('update:value', (event.target as HTMLInputElement).value),
    });
  const Menu: FunctionalComponent = (_props, { emit, slots }) =>
    h(
      'div',
      {
        onClick: (event: Event) => {
          const item = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-key]',
          );
          if (item) emit('click', { key: item.dataset.key ?? '' });
        },
      },
      slots.default?.(),
    );
  const MenuItem: FunctionalComponent = (_props, { attrs, slots }) =>
    h('button', { 'data-key': String(attrs.key ?? 'profile') }, slots.default?.());
  const Modal: FunctionalComponent<{
    cancelButtonProps?: { disabled?: boolean };
    closable?: boolean;
    keyboard?: boolean;
    maskClosable?: boolean;
    okButtonProps?: { disabled?: boolean };
    okText?: string;
    open?: boolean;
  }> = (props, { emit, slots }) =>
    props.open
      ? h(
          'div',
          {
            'data-closable': String(props.closable ?? true),
            'data-keyboard': String(props.keyboard ?? true),
            'data-mask-closable': String(props.maskClosable ?? true),
            'data-modal': 'true',
          },
          [
            slots.default?.(),
            h(
              'button',
              {
                'data-action': 'ok',
                disabled: Boolean(props.okButtonProps?.disabled),
                onClick: () => emit('ok'),
              },
              props.okText ?? '',
            ),
            h(
              'button',
              {
                'data-action': 'cancel',
                disabled: Boolean(props.cancelButtonProps?.disabled),
                onClick: () => emit('cancel'),
              },
              'cancel',
            ),
          ],
        )
      : null;
  Modal.props = [
    'cancelButtonProps',
    'closable',
    'keyboard',
    'maskClosable',
    'okButtonProps',
    'okText',
    'open',
  ];
  Modal.emits = ['cancel', 'ok'];
  Input.props = ['disabled', 'maxlength', 'value'];
  Input.emits = ['update:value'];
  Menu.emits = ['click'];
  Button.props = ['disabled'];
  Button.emits = ['click'];
  Alert.props = ['message'];
  return {
    Alert,
    Button,
    Dropdown,
    Form,
    FormItem,
    Input,
    Menu,
    MenuItem,
    Modal,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseSession = {
  administrator: true,
  authenticated: true,
  content_school_id: 'school',
  csrf_token: 'a'.repeat(43),
  expires_at: '2030-01-01T00:00:00Z',
  phone_bound: true,
  profile: {
    bio: '',
    group_card_consent: {
      department: false,
      gender: false,
      grade: false,
      name: false,
      nickname: false,
      school: false,
      student_id: false,
    },
    id: '00000000-0000-4000-8000-000000000001',
    nickname: 'Initial',
    nickname_required: false,
    revision: 1,
    visibility: {
      badge: true,
      department: true,
      grade: false,
      resources: true,
      reviews: true,
      school: true,
    },
  },
};

describe('SessionControls nickname editing (A-12)', () => {
  it('enforces 1..20 code point validation, refreshes revision on 409 conflict, and locks modal during uncertain writes', async () => {
    let serverRevision = 1;
    let mode: 'conflict' | 'lost' | 'ok' = 'conflict';
    const sent: Array<{
      key: null | string;
      nickname: string;
      revision: number;
    }> = [];

    const store = createSessionStore(async (_input, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          nickname: string;
          revision: number;
        };
        sent.push({
          key: new Headers(init.headers).get('Idempotency-Key'),
          nickname: body.nickname,
          revision: body.revision,
        });
        if (mode === 'conflict') {
          serverRevision = 2;
          return Response.json(
            {
              code: 'revision_conflict',
              current: {
                ...baseSession.profile,
                nickname: 'Other',
                revision: 2,
              },
            },
            { status: 409 },
          );
        }
        if (mode === 'lost') {
          throw new TypeError('network down');
        }
        serverRevision = body.revision + 1;
        return Response.json({
          ...baseSession.profile,
          nickname: body.nickname,
          revision: serverRevision,
        });
      }
      return Response.json({
        ...baseSession,
        profile: { ...baseSession.profile, revision: serverRevision },
      });
    });
    await store.reload();

    const app = createApp(SessionControls);
    app.provide(sessionKey, store);
    const root = document.createElement('div');
    document.body.append(root);
    app.mount(root);

    try {
      const menuButtons = [...root.querySelectorAll<HTMLElement>('[data-key]')];
      menuButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();

      const modal = root.querySelector<HTMLElement>('[data-modal="true"]');
      expect(modal?.dataset.maskClosable).toBe('false');
      const input = root.querySelector('input') as HTMLInputElement;
      expect(input.hasAttribute('maxlength')).toBe(false);

      const okButton = () =>
        root.querySelector('[data-action="ok"]') as HTMLButtonElement;

      // Blank nickname disables confirmation
      input.value = '   ';
      input.dispatchEvent(new Event('input'));
      await nextTick();
      expect(okButton().disabled).toBe(true);

      // A supplementary character uses two UTF-16 units but counts as one code point.
      input.value = '😀'.repeat(20);
      input.dispatchEvent(new Event('input'));
      await nextTick();
      expect(okButton().disabled).toBe(false);

      input.value += '😀';
      input.dispatchEvent(new Event('input'));
      await nextTick();
      expect(okButton().disabled).toBe(true);

      // Valid nickname encountering 409 refreshes revision so next save succeeds
      input.value = 'UpdatedNick';
      input.dispatchEvent(new Event('input'));
      await nextTick();
      expect(okButton().disabled).toBe(false);
      okButton().click();
      await vi.waitFor(() => {
        expect(root.querySelector('[role="alert"]')?.textContent).toContain(
          'errors.conflict',
        );
      });
      expect(store.session.value?.profile.revision).toBe(2);

      // Uncertain write disables Esc/close/mask and reuses original key on retry
      mode = 'lost';
      okButton().click();
      await vi.waitFor(() => {
        expect(root.querySelector('[role="alert"]')?.textContent).toContain(
          'common.uncertain',
        );
      });
      expect(sent.at(-1)?.revision).toBe(2);
      const originalKey = sent.at(-1)?.key;
      expect(originalKey).toBeTruthy();

      const lockedModal = root.querySelector<HTMLElement>('[data-modal="true"]');
      expect(lockedModal?.dataset.closable).toBe('false');
      expect(lockedModal?.dataset.keyboard).toBe('false');

      mode = 'ok';
      okButton().click();
      await vi.waitFor(() => {
        expect(root.querySelector('[data-modal="true"]')).toBeNull();
      });
      expect(sent.at(-1)).toEqual({
        key: originalKey,
        nickname: 'UpdatedNick',
        revision: 2,
      });
      expect(store.session.value?.profile.nickname).toBe('UpdatedNick');
    } finally {
      app.unmount();
      root.remove();
    }
  });
});
