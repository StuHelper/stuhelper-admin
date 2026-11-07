// Colors group states only; every badge still shows the translated state text.
const tones: Record<string, 'error' | 'success' | 'warning'> = {
  active: 'success', applied: 'success', approved: 'success', published: 'success', ready: 'success',
  blocked: 'warning', decided: 'warning', draining: 'warning', paused: 'warning', pending: 'warning', waiting: 'warning', manual: 'warning',
  deleted: 'error', failed: 'error', hidden: 'error', rejected: 'error', revoked: 'error',
};
export const stateTone = (state: string) => tones[state] ?? 'default';

const schoolKey = 'stuhelper-admin:last-school';
// A remembered school is only a form default. The server still authorizes each request.
export function rememberedSchool(ids: string[]) {
  if (ids.length === 1) return ids[0] ?? '';
  try { const value = localStorage.getItem(schoolKey) ?? ''; return ids.includes(value) ? value : ''; } catch { return ''; }
}
export function rememberSchool(id: string) {
  try { if (id) localStorage.setItem(schoolKey, id); } catch { /* Browser storage is optional. */ }
}

// antd Tag preset colors share the same names as the tones above.
export const tagColor = (state: string) => stateTone(state);
