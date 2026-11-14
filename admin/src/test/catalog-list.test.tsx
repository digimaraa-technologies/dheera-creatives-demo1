import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogApi } from '../api/catalog';
import { ToastProvider } from '../hooks/useToast';
import { CatalogListPage } from '../pages/CatalogListPage';
import type { CatalogItem, Paginated } from '../types';

vi.mock('../api/catalog', () => ({
  catalogApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    upload: vi.fn(),
  },
}));

const list = vi.mocked(catalogApi.list);
const update = vi.mocked(catalogApi.update);
const remove = vi.mocked(catalogApi.remove);

const PRODUCT: CatalogItem = {
  id: 'product-1',
  name: 'Silk Aari Blouse',
  slug: 'silk-aari-blouse',
  description: 'Hand-embroidered blouse',
  category: 'Blouses',
  imageUrl: '/uploads/products/photo.png',
  imageFilename: 'photo.png',
  price: 1250.5,
  displayOrder: 2,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function page(items: CatalogItem[], total = items.length): Paginated<CatalogItem> {
  return {
    items,
    total,
    page: 1,
    pageSize: 10,
    totalPages: Math.max(1, Math.ceil(total / 10)),
    categories: ['Blouses', 'Sarees'],
  };
}

function renderList() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CatalogListPage kind="products" />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('catalogue list', () => {
  it('renders rows from the API', async () => {
    list.mockResolvedValue(page([PRODUCT]));
    renderList();

    expect(await screen.findByText('Silk Aari Blouse')).toBeInTheDocument();
    expect(screen.getByText('/silk-aari-blouse')).toBeInTheDocument();
    expect(screen.getByText('Active', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('₹1,250.50')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(
      'products',
      expect.objectContaining({ page: 1, pageSize: 10 }),
    );
  });

  it('shows an empty state when nothing matches', async () => {
    list.mockResolvedValue(page([], 0));
    renderList();

    expect(await screen.findByText('No products found')).toBeInTheDocument();
  });

  it('shows an error and retries', async () => {
    list.mockRejectedValueOnce(new Error('Could not reach the server'));
    list.mockResolvedValueOnce(page([PRODUCT]));
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText('Could not reach the server')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Silk Aari Blouse')).toBeInTheDocument();
  });

  it('sends the search term and resets to page one', async () => {
    list.mockResolvedValue(page([PRODUCT]));
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Silk Aari Blouse');

    await user.type(screen.getByLabelText('Search products'), 'silk');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        'products',
        expect.objectContaining({ search: 'silk', page: 1 }),
      ),
    );
  });

  it('toggles visibility through the update endpoint', async () => {
    list.mockResolvedValue(page([PRODUCT]));
    update.mockResolvedValue({ ...PRODUCT, isActive: false });
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Silk Aari Blouse');

    await user.click(screen.getByRole('button', { name: 'Hide Silk Aari Blouse' }));

    expect(update).toHaveBeenCalledWith('products', 'product-1', { isActive: false });
    expect(await screen.findByText('Inactive', { selector: '.badge' })).toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    list.mockResolvedValueOnce(page([PRODUCT])).mockResolvedValueOnce(page([], 0));
    remove.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Silk Aari Blouse');

    await user.click(screen.getByRole('button', { name: 'Delete Silk Aari Blouse' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete product?');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(remove).toHaveBeenCalledWith('products', 'product-1');
    expect(await screen.findByText('No products found')).toBeInTheDocument();
  });
});
