import type {
  CatalogInput,
  CatalogItem,
  CatalogKind,
  CatalogQuery,
  Paginated,
  ReorderItem,
  UploadedImage,
} from '../types';
import { apiRequest, toQuery } from './client';

export const catalogApi = {
  list(kind: CatalogKind, query: CatalogQuery): Promise<Paginated<CatalogItem>> {
    return apiRequest(`/api/admin/${kind}${toQuery(query)}`);
  },
  get(kind: CatalogKind, id: string): Promise<CatalogItem> {
    return apiRequest(`/api/admin/${kind}/${id}`);
  },
  create(kind: CatalogKind, input: CatalogInput): Promise<CatalogItem> {
    return apiRequest(`/api/admin/${kind}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  update(kind: CatalogKind, id: string, input: Partial<CatalogInput>): Promise<CatalogItem> {
    return apiRequest(`/api/admin/${kind}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  remove(kind: CatalogKind, id: string): Promise<{ success: true }> {
    return apiRequest(`/api/admin/${kind}/${id}`, { method: 'DELETE' });
  },
  reorder(
    kind: CatalogKind,
    items: ReorderItem[],
  ): Promise<{ success: true; updated: number }> {
    return apiRequest(`/api/admin/${kind}/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ items }),
    });
  },
  upload(kind: CatalogKind, file: File): Promise<UploadedImage> {
    const body = new FormData();
    body.append('image', file);
    return apiRequest(`/api/admin/uploads/${kind}`, { method: 'POST', body });
  },
};
