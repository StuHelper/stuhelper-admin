export type { QuotaUnit } from '../../api/capacity';
export { defaultQuotaUnit, formatQuotaInput as formatQuotaPlaceholder, parseQuotaBytes } from '../../api/capacity';

/** Display name of a storage adapter; unknown adapters show their identifier. */
export const adapterName = (id: string) => (id === 'bhpan' ? 'BHpan' : id);
