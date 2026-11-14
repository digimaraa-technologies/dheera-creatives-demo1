export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categories: string[];
}

export function pageArgs(
  page: number,
  pageSize: number,
): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
