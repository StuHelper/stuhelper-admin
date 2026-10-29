import { type App, createApp, nextTick } from 'vue';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import VerificationView from './verification.vue';
const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), write: vi.fn() }));
vi.mock('#/api/verification', () => ({ verification: api, methods: [], VerificationError: class extends Error { constructor(public code: string) { super(code); } } }));
vi.mock('@vben/locales', () => ({ useI18n: () => ({ t: (key: string) => key, d: () => 'date', n: String }) }));
vi.mock('@vben/common-ui', () => ({ Page: { template: '<main><slot /></main>' } }));
let app: App; let root: HTMLDivElement;
async function settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick(); } }
function button(key: string) { const node = [...root.querySelectorAll('button')].findLast(el => el.textContent?.trim() === key); if (!node) throw new Error('missing button '+key); return node; }
function input(selector: string, value: string) { const node = root.querySelector<HTMLInputElement>(selector); if (!node) throw new Error('missing input'); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }
beforeEach(async () => { vi.clearAllMocks(); api.list.mockImplementation(async (kind: string) => kind === 'School' ? [{id:'A',name:'A'}] : Array.from({length:25},(_,i)=>({id:'a'+i,stage:'bachelor',kind:'student',created_at:'2026-01-01T00:00:00Z'}))); api.get.mockResolvedValue({id:'credential-a',school_id:'A',student_display:'student-a',kind:'student',state:'active',revision:1}); root=document.createElement('div');document.body.append(root);app=createApp(VerificationView);app.mount(root);await settle(); });
afterEach(()=>{app.unmount();root.remove();});
it('clears stale credential actions when a new lookup fails',async()=>{button('page.verification.credentialManagement').click();await settle();input('.admin-panel input','credential-a');await settle();button('page.verification.load').click();await settle();const note=root.querySelector('textarea');if(!note)throw new Error('missing note');note.value='revoke';note.dispatchEvent(new Event('input',{bubbles:true}));await settle();expect(button('page.verification.revoke').disabled).toBe(false);api.get.mockRejectedValue(new Error('not found'));input('.admin-panel input','credential-b');await settle();button('page.verification.load').click();await settle();expect(root.textContent).not.toContain('student-a');expect(root.querySelector('textarea')).toBeNull();expect(api.write).not.toHaveBeenCalled();});
it('resets a school queue and its cursor when the school filter changes',async()=>{expect(root.querySelectorAll('.admin-grid article')).toHaveLength(25);input('input[list="verification-schools"]','B');await settle();expect(root.querySelectorAll('.admin-grid article')).toHaveLength(0);expect(root.textContent).not.toContain('page.verification.loadMore');button('page.verification.load').click();await settle();expect(api.list).toHaveBeenLastCalledWith('Application','/api/v1/admin/verification/schools/B/applications?limit=25&after=');});
