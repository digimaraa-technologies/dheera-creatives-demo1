import type { CatalogItem, CatalogQuery, Paginated, ReorderItem } from '../types';

/** Pure helpers behind the drag-and-drop sorting, kept out of the page for tests. */

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The API expects 1-based positions covering the whole visible catalogue. */
export function reorderPayload(items: readonly Pick<CatalogItem, 'id'>[]): ReorderItem[] {
  return items.map((item, index) => ({ id: item.id, displayOrder: index + 1 }));
}

export function withDisplayOrder(items: readonly CatalogItem[]): CatalogItem[] {
  return items.map((item, index) => ({ ...item, displayOrder: index + 1 }));
}

/**
 * Sorting by hand is only safe when the visible rows are the entire catalogue,
 * otherwise the payload would silently renumber a filtered subset.
 */
export function canReorderCatalog(
  query: CatalogQuery,
  data: Paginated<CatalogItem> | null,
): boolean {
  if (!data || data.page !== 1 || data.total < 2 || data.totalPages !== 1) return false;

  return (
    query.search === '' &&
    query.category === '' &&
    query.isActive === '' &&
    query.sortBy === 'displayOrder' &&
    query.sortDir === 'asc'
  );
}
