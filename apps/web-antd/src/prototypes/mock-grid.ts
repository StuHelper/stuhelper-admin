import { useVbenVxeGrid } from '#/adapter/vxe-table';

type Values = Record<string, any>;
type GridOptions<T extends Values> = NonNullable<Parameters<typeof useVbenVxeGrid<T>>[0]['gridOptions']>;

// Prototype tables show fixed mock rows. Paging stays off until a real query exists.
export function useMockGrid<T extends Values>(gridOptions: GridOptions<T>) {
  return useVbenVxeGrid<T>({ gridOptions: { pagerConfig: { enabled: false }, ...gridOptions } });
}

// Stands in for the future server query, so the Vben search form and pager behave as in production.
export function mockQuery<T>(rows: T[], match: (row: T, form: Values) => boolean = () => true) {
  return {
    ajax: {
      query: async ({ page }: { page?: { currentPage?: number; pageSize?: number } }, form: Values) => {
        const items = rows.filter((row) => match(row, form));
        // Without a pager vxe passes an empty page object, so every matching row is returned.
        if (!page?.currentPage || !page.pageSize) return { items, total: items.length };
        const start = (page.currentPage - 1) * page.pageSize;
        return { items: items.slice(start, start + page.pageSize), total: items.length };
      },
    },
  };
}
