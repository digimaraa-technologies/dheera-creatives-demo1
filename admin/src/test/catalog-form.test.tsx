import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogApi } from '../api/catalog';
import { ToastProvider } from '../hooks/useToast';
import { CatalogFormPage } from '../pages/CatalogFormPage';
import type { CatalogItem } from '../types';

vi.mock('../api/catalog', () => ({
  catalogApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    uploadStatus: vi.fn(),
    upload: vi.fn(),
  },
}));

const get = vi.mocked(catalogApi.get);
const create = vi.mocked(catalogApi.create);
const update = vi.mocked(catalogApi.update);
const uploadStatus = vi.mocked(catalogApi.uploadStatus);
const upload = vi.mocked(catalogApi.upload);

const PRODUCT: CatalogItem = {
  id: 'product-1',
  name: 'Silk Aari Blouse',
  slug: 'silk-aari-blouse',
  description: 'Hand-embroidered blouse',
  category: 'Blouses',
  imageUrl: '/uploads/products/old.png',
  imageFilename: 'old.png',
  price: 1250.5,
  displayOrder: 2,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderForm(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route path="/products/new" element={<CatalogFormPage kind="products" />} />
          <Route path="/products/:id/edit" element={<CatalogFormPage kind="products" />} />
          <Route path="/products" element={<div>Product list</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadStatus.mockResolvedValue({ enabled: true });
});

describe('catalogue form', () => {
  it('generates a slug from the name', async () => {
    const user = userEvent.setup();
    renderForm('/products/new');

    await user.type(screen.getByLabelText('Name'), 'Silk Aari Blouse');

    expect(screen.getByLabelText('URL slug')).toHaveValue('silk-aari-blouse');
  });

  it('keeps a manually edited slug', async () => {
    const user = userEvent.setup();
    renderForm('/products/new');

    await user.type(screen.getByLabelText('URL slug'), 'custom-slug');
    await user.type(screen.getByLabelText('Name'), 'Another name');

    expect(screen.getByLabelText('URL slug')).toHaveValue('custom-slug');
  });

  it('validates required fields and the image', async () => {
    const user = userEvent.setup();
    renderForm('/products/new');

    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Description is required.')).toBeInTheDocument();
    expect(screen.getByText('Category is required.')).toBeInTheDocument();
    expect(screen.getByText('Choose an image.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('uploads the image then creates the record', async () => {
    upload.mockResolvedValue({
      imageUrl: '/uploads/products/new.png',
      imageFilename: 'new.png',
    });
    create.mockResolvedValue({ ...PRODUCT, name: 'Silk Aari Blouse' });
    const user = userEvent.setup();
    renderForm('/products/new');

    await user.type(screen.getByLabelText('Name'), 'Silk Aari Blouse');
    await user.type(screen.getByLabelText('Description'), 'Hand-embroidered blouse');
    await user.type(screen.getByLabelText('Category'), 'Blouses');

    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Image file'), file);
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('Product list')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith('products', file);
    expect(create).toHaveBeenCalledWith(
      'products',
      expect.objectContaining({
        name: 'Silk Aari Blouse',
        slug: 'silk-aari-blouse',
        description: 'Hand-embroidered blouse',
        category: 'Blouses',
        imageUrl: '/uploads/products/new.png',
        imageFilename: 'new.png',
        isActive: true,
      }),
    );
  });

  it('rejects unsupported image types before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderForm('/products/new');

    const file = new File(['<svg />'], 'icon.svg', { type: 'image/svg+xml' });
    await user.upload(screen.getByLabelText('Image file'), file);

    expect(screen.getByText('Use a JPEG, PNG, WebP or AVIF image.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('loads an existing record and keeps its image on update', async () => {
    get.mockResolvedValue(PRODUCT);
    update.mockResolvedValue(PRODUCT);
    const user = userEvent.setup();
    renderForm('/products/product-1/edit');

    await screen.findByRole('heading', { name: 'Edit product' });
    expect(screen.getByLabelText('Name')).toHaveValue('Silk Aari Blouse');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(
      'products',
      'product-1',
      expect.objectContaining({
        name: 'Silk Aari Blouse',
        imageUrl: '/uploads/products/old.png',
        imageFilename: 'old.png',
      }),
    );
    expect(upload).not.toHaveBeenCalled();
    expect(await screen.findByText('Product list')).toBeInTheDocument();
  });

  it('warns upfront and disables creation when production uploads are disabled', async () => {
    uploadStatus.mockResolvedValue({ enabled: false });
    renderForm('/products/new');

    expect(
      await screen.findByText(/Image uploads are disabled in production until durable storage is configured/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create product' })).toBeDisabled();
    expect(screen.getByLabelText('Image file')).toBeDisabled();
  });
});
