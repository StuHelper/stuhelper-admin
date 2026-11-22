// @vitest-environment happy-dom
import type { PropType, SetupContext } from 'vue';

import type { Decision, Task } from './api';

import { createApp, h, nextTick, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Http } from '#/shared/api/http';
import { hostFetchKey } from '#/shared/api/transport';

import { AcademicAdminApi } from './api';
import TeacherHomepageComplaintPanel from './TeacherHomepageComplaintPanel.vue';

interface SelectOption {
  label: string;
  value: string;
}

vi.mock('@vben/locales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vben/locales')>();
  return {
    ...actual,
    useI18n: () => ({
      locale: ref('en-US'),
      t: (key: string) => key,
      te: () => true,
    }),
  };
});

vi.mock('ant-design-vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ant-design-vue')>();
  return {
    ...actual,
    Select: {
      props: {
        options: { type: Array as PropType<SelectOption[]>, required: true },
        value: { type: String, default: '' },
      },
      emits: ['update:value'],
      setup(
        props: { options: SelectOption[]; value: string },
        { emit }: SetupContext<['update:value']>,
      ) {
        return () =>
          h(
            'select',
            {
              value: props.value,
              onChange: (event: Event) =>
                emit('update:value', (event.target as HTMLSelectElement).value),
            },
            [
              h('option', { value: '' }),
              ...props.options.map(
                (item) => h('option', { value: item.value }, item.label),
              ),
            ],
          );
      },
    },
  };
});

const report: Task = {
  content_kind: 'teacher_homepage',
  created_at: '2026-11-18T00:00:00Z',
  id: 'complaint-a',
  object_revision: 17,
  revision: 5,
  school_id: 'buaa',
  state: 'waiting',
  submission: {
    category: 'privacy_leak',
    evidence: ['Private synthetic evidence'],
    kind: 'report',
    object_id: 'teacher-homepage:teacher:a',
    reason: 'Private synthetic description',
  },
  updated_at: '2026-11-18T00:00:00Z',
};
const targetPath = '/api/v1/moderation/teacher-homepage-complaints/teacher%3Aa/target';
const taskPath = `/api/v1/moderation/tasks/${report.id}`;
const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const clear of cleanup.splice(0)) clear();
});

function mount(fetcher: typeof fetch) {
  const panel = document.createElement('main');
  document.body.append(panel);
  const pending = vi.fn();
  const app = createApp(TeacherHomepageComplaintPanel, {
    onPending: pending,
    schoolId: report.school_id,
    taskId: report.id,
  });
  app.provide(hostFetchKey, fetcher);
  app.mount(panel);
  cleanup.push(() => {
    app.unmount();
    panel.remove();
  });
  return {
    panel,
    pending,
    buttons: (text: string) => {
      const button = [...panel.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === text,
      );
      if (!button) throw new Error(`Button missing: ${text}`);
      return button;
    },
  };
}

async function fill(panel: HTMLElement, value: Decision['action']) {
  const action = panel.querySelector<HTMLSelectElement>('#teacher-homepage-complaint-action');
  const reason = panel.querySelector<HTMLTextAreaElement>('#teacher-homepage-complaint-reason');
  if (!action || !reason) throw new Error('Decision form missing');
  action.value = value;
  action.dispatchEvent(new Event('change'));
  reason.value = 'Review completed';
  reason.dispatchEvent(new Event('input'));
  await nextTick();
}

interface Write {
  body: { decision: Decision; revision: number };
  key: null | string;
}
function readDecision(init?: RequestInit): Write {
  return {
    body: JSON.parse(String(init?.body)),
    key: new Headers(init?.headers).get('Idempotency-Key'),
  };
}

describe('teacher homepage complaint triage', () => {
  it('reads the complaint page with the explicit content filter and opaque cursor', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ items: [report], next_cursor: 't1.following' }),
    );
    const api = new AcademicAdminApi(new Http(fetcher));
    const result = await api.teacherComplaints({ after: 't1.previous', school_id: 'buaa' });
    expect(result).toEqual({ items: [report], next_cursor: 't1.following' });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/v1/moderation/tasks/page');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      admin: 'true',
      after: 't1.previous',
      content_kind: 'teacher_homepage',
      school_id: 'buaa',
    });
  });

  it('re-reads both revisions on conflict and keeps the original write on uncertain retry', async () => {
    const writes: Write[] = [];
    let revised = false;
    let applied: Task | undefined;
    const { buttons, panel, pending } = mount(async (input, init) => {
      switch (input) {
        case `${taskPath}/decisions`: {
          const write = readDecision(init);
          writes.push(write);
          if (writes.length === 1) {
            revised = true;
            return Response.json({ code: 'conflict' }, { status: 409 });
          }
          if (writes.length === 2) throw new TypeError('lost response');
          applied = {
            ...report,
            decision: write.body.decision,
            revision: 7,
            state: 'applied',
          };
          return Response.json(applied);
        }
        case targetPath: {
          return Response.json({
            object_id: report.submission.object_id,
            revision: revised ? 212 : 101,
            school_id: report.school_id,
            visible: !applied,
          });
        }
        case taskPath: {
          return Response.json(applied ?? { ...report, revision: revised ? 6 : report.revision });
        }
        default: {
          return Response.json({ code: 'not_found' }, { status: 404 });
        }
      }
    });

    const apply = () => buttons('page.moderation.applyDecision');
    await vi.waitFor(() => expect(apply().disabled).toBe(true));
    await fill(panel, 'hide');
    expect(apply().disabled).toBe(false);
    apply().click();
    await vi.waitFor(() => expect(panel.textContent).toContain('page.errors.conflict'));
    expect(apply().disabled).toBe(true);
    expect(writes[0]?.body).toMatchObject({
      decision: { action: 'hide', object_id: report.submission.object_id, revision: 101 },
      revision: 5,
    });
    buttons('page.common.reloadCompare').click();
    await vi.waitFor(() => expect(apply().disabled).toBe(false));
    expect(panel.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Review completed');
    apply().click();
    await vi.waitFor(() => expect(pending).toHaveBeenLastCalledWith(true, true, true));
    expect(apply().disabled).toBe(true);
    expect(writes[1]?.body).toMatchObject({
      decision: { action: 'hide', category: 'privacy_leak', revision: 212 },
      revision: 6,
    });
    expect(writes[1]?.key).not.toBe(writes[0]?.key);

    buttons('page.common.retryOriginal').click();
    await vi.waitFor(() => expect(panel.textContent).toContain('page.moderation.taskState.applied'));
    expect(writes).toHaveLength(3);
    expect(writes[2]).toEqual(writes[1]);
  });

  it('offers only dismissal for a missing target and uses the complaint revision', async () => {
    const writes: Write[] = [];
    const { buttons, panel } = mount(async (input, init) => {
      if (input === taskPath) return Response.json(report);
      if (input === `${taskPath}/decisions`) {
        const write = readDecision(init);
        writes.push(write);
        return Response.json({ ...report, decision: write.body.decision, state: 'applied' });
      }
      return Response.json({ code: 'not_found' }, { status: 404 });
    });

    await vi.waitFor(() =>
      expect(panel.textContent).toContain('page.teacherHomepage.moderation.missing'),
    );
    const options = panel.querySelector<HTMLSelectElement>('#teacher-homepage-complaint-action')?.options;
    expect([...(options ?? [])].map((option) => option.value)).toEqual(['', 'dismiss']);
    await fill(panel, 'dismiss');
    buttons('page.moderation.applyDecision').click();
    await vi.waitFor(() => expect(panel.textContent).toContain('page.moderation.taskState.applied'));
    expect(writes[0]?.body).toMatchObject({
      decision: { action: 'dismiss', object_id: report.submission.object_id, revision: 17 },
      revision: 5,
    });
  });

  it('withholds complaint materials and actions when the target read is forbidden', async () => {
    const { panel } = mount(async (input) =>
      input === taskPath
        ? Response.json(report)
        : Response.json({ code: 'forbidden' }, { status: 403 }),
    );
    await vi.waitFor(() => expect(panel.textContent).toContain('page.errors.forbidden'));
    expect(panel.textContent).not.toContain(report.submission.reason);
    expect(panel.textContent).not.toContain('Private synthetic evidence');
    expect(panel.querySelector('form')).toBeNull();
  });
});
