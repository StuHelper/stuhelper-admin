import { type App, createApp, nextTick } from 'vue';

import { afterEach, expect, it, vi } from 'vitest';

import ModerationView from './ModerationView.vue';
const api = vi.hoisted(() => ({ call: vi.fn(), objectOptions: vi.fn() }));
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), ...api }));
vi.mock('@vben/locales', () => ({ useI18n: () => ({ t: (key: string) => key, d: () => 'date' }) }));
vi.mock('@vben/common-ui', () => ({ Page: { template: '<main><slot /></main>' } }));
vi.mock('ant-design-vue', () => ({ Card: { template: '<div><slot /></div>' } }));
vi.mock('./BatchPanel.vue', () => ({ default: { props: ['tasks'], template: '<div class="batch-input">{{ tasks.map(t => t.id).join() }}</div>' } }));
let app: App | undefined; let root: HTMLDivElement;
afterEach(()=>{app?.unmount();root?.remove();vi.clearAllMocks();});
it('keeps resource tasks out of academic decisions and preserves the server page cursor',async()=>{
 const task={id:'academic',content_kind:'course',submission:{kind:'review',reason:'academic reason'},state:'waiting',updated_at:'2026-10-29T00:00:00Z'};
 const rows=[task,...Array.from({length:19},(_,i)=>({...task,id:'resource-'+i,content_kind:'resource',submission:{kind:'review',reason:'resource reason'}}))];
 api.objectOptions.mockResolvedValue({items:[{id:'school',name:'School'}]});api.call.mockResolvedValue(rows);
 root=document.createElement('div');document.body.append(root);app=createApp(ModerationView);app.mount(root);
 for(let i=0;i<20;i++){await Promise.resolve();await nextTick();}
 expect(root.querySelectorAll('.admin-list-item')).toHaveLength(1);expect(root.querySelector('.batch-input')?.textContent).toBe('academic');expect(root.textContent).not.toContain('resource reason');
 const next=[...root.querySelectorAll('button')].find(n=>n.textContent==='page.academic.next');if(!next)throw new Error('missing next page');next.click();
 for(let i=0;i<12;i++){await Promise.resolve();await nextTick();}
 expect(api.call.mock.calls.at(-1)?.[1]).toContain('after=resource-18');
});
