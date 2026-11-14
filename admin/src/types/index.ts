export interface Admin {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export type CatalogKind = 'products' | 'services';

export interface CatalogItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  imageUrl: string;
  imageFilename: string | null;
  price: number | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categories: string[];
}

export type SortField = 'displayOrder' | 'createdAt' | 'name';
export type SortDir = 'asc' | 'desc';

export interface CatalogQuery {
  page: number;
  pageSize: number;
  search: string;
  category: string;
  isActive: '' | 'true' | 'false';
  sortBy: SortField;
  sortDir: SortDir;
}

export interface CatalogInput {
  name: string;
  slug?: string;
  description: string;
  category: string;
  imageUrl: string;
  imageFilename?: string;
  price?: number | null;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UploadedImage {
  imageUrl: string;
  imageFilename: string;
}

export interface ReorderItem {
  id: string;
  displayOrder: number;
}
