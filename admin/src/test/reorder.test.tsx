import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogApi } from '../api/catalog';
import { ToastProvider } from '../hooks/useToast';
import {
  canReorderCatalog,
  moveItem,
  reorderPayload,
  withDisplayOrder,
} from '../lib/reorder';
import { CatalogListPage } from '../pages/CatalogListPage';
import type { CatalogItem, CatalogQuery, Paginated } from '../types';

// Real dnd-kit drag simulation does not settle in jsdom, so the sensors are
// replaced with a deterministic "drop" control that calls onDragEnd directly.
const dnd = vi.hoisted(() => ({
  activeId: null as string | null,
  overId: null as string | null,
}));

vi.mock('@dnd-kit/core', async () => {
  const React = await import('react');

  return {
    DndContext: ({
      children,
      onDragStart,
      onDragEnd,
    }: {
      children?: ReactNode;
      onDragStart?: (event: { active: { id: string } }) => void;
      onDragEnd?: (event: {
        active: { id: string };
        over: { id: string } | null;
      }) => void;
    }) =>
      React.createElement(
        React.Fragment,
        null,
        children,
        React.createElement('button', {
          type: 'button',
          'data-testid': 'simulate-drop',
          onClick: () => {
            if (!dnd.activeId) return;
            onDragStart?.({ active: { id: dnd.activeId } });
            onDragEnd?.({
              active: { id: dnd.activeId },
              over: dnd.overId ? { id: dnd.overId } : null,
            });
          },
        }),
      ),
    DragOverlay: () => null,
    KeyboardSensor: class {},
    PointerSensor: class {},
    useSensor: () => ({}),
    useSensors: () => [],
    closestCenter: () => [],
  };
});

vi.mock('@dnd-kit/sortable', async () => {
  const React = await import('react');

  return {
    SortableContext: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    verticalListSortingStrategy: {},
    sortableKeyboardCoordinates: () => ({}),
    useSortable: () => ({
      attributes: {
        role: 'button',
        tabIndex: 0,
        'aria-roledescription': 'sortable',
      },
      listeners: {},
      setNodeRef: () => undefined,
      setActivatorNodeRef: () => undefined,
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

vi.mock('../api/catalog', () => ({
  catalogApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    upload: vi.fn(),
  },
}));

const list = vi.mocked(catalogApi.list);
const reorder = vi.mocked(catalogApi.reorder);

const QUERY: CatalogQuery = {
  page: 1,
  pageSize: 10,
  search: '',
  category: '',
  isActive: '',
  sortBy: 'displayOrder',
  sortDir: 'asc',
};

function item(id: string, name: string, displayOrder: number): CatalogItem {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    description: `${name} description`,
    category: 'Blouses',
    imageUrl: '/uploads/products/photo.png',
    imageFilename: 'photo.png',
    price: 1000 + displayOrder,
    displayOrder,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const FIRST = item('p1', 'First Design', 1);
const SECOND = item('p2', 'Second Design', 2);
const THIRD = item('p3', 'Third Design', 3);
const ITEMS = [FIRST, SECOND, THIRD];

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

function rowNames(): Array<string | null> {
  return Array.from(document.querySelectorAll('tbody .cell-title')).map((el) => el.textContent);
}

function handle(name: string) {
  return screen.getByRole('button', { name: `Reorder ${name}` });
}

async function drop(
  user: ReturnType<typeof userEvent.setup>,
  fromId: string,
  toId: string | null,
) {
  dnd.activeId = fromId;
  dnd.overId = toId;
  await user.click(screen.getByTestId('simulate-drop'));
}

beforeEach(() => {
  vi.clearAllMocks();
  dnd.activeId = null;
  dnd.overId = null;
  list.mockReset();
  reorder.mockReset();
  list.mockResolvedValue(page(ITEMS));
  reorder.mockResolvedValue({ success: true, updated: 3 });
});

describe('reorder helpers', () => {
  it('moves an item and ignores out-of-range indexes', () => {
    expect(moveItem(ITEMS, 2, 0).map((row) => row.id)).toEqual(['p3', 'p1', 'p2']);
    expect(moveItem(ITEMS, 0, 2).map((row) => row.id)).toEqual(['p2', 'p3', 'p1']);
    expect(moveItem(ITEMS, 1, 1)).toEqual(ITEMS);
    expect(moveItem(ITEMS, -1, 0)).toEqual(ITEMS);
    expect(moveItem(ITEMS, 0, 5)).toEqual(ITEMS);
  });

  it('builds a 1-based payload and renumbers the optimistic rows', () => {
    const moved = moveItem(ITEMS, 2, 0);
    expect(reorderPayload(moved)).toEqual([
      { id: 'p3', displayOrder: 1 },
      { id: 'p1', displayOrder: 2 },
      { id: 'p2', displayOrder: 3 },
    ]);
    expect(withDisplayOrder(moved).map((row) => row.displayOrder)).toEqual([1, 2, 3]);
  });

  it('only enables sorting when the whole catalogue is visible', () => {
    expect(canReorderCatalog(QUERY, page(ITEMS))).toBe(true);
    expect(canReorderCatalog(QUERY, page(ITEMS, 25))).toBe(false);
    expect(canReorderCatalog(QUERY, page([FIRST]))).toBe(false);
    expect(canReorderCatalog(QUERY, null)).toBe(false);
    expect(canReorderCatalog(QUERY, { ...page(ITEMS), page: 2 })).toBe(false);
    expect(canReorderCatalog({ ...QUERY, search: 'silk' }, page(ITEMS))).toBe(false);
    expect(canReorderCatalog({ ...QUERY, category: 'Blouses' }, page(ITEMS))).toBe(false);
    expect(canReorderCatalog({ ...QUERY, isActive: 'true' }, page(ITEMS))).toBe(false);
    expect(canReorderCatalog({ ...QUERY, sortBy: 'name' }, page(ITEMS))).toBe(false);
    expect(canReorderCatalog({ ...QUERY, sortDir: 'desc' }, page(ITEMS))).toBe(false);
  });
});

describe('catalogue drag and drop', () => {
  it('renders a keyboard-accessible drag handle for every row', async () => {
    renderList();
    await screen.findByText('First Design');

    for (const name of ['First Design', 'Second Design', 'Third Design']) {
      const grip = handle(name);
      expect(grip).toBeEnabled();
      expect(grip).toHaveAttribute('aria-roledescription', 'sortable');
      expect(grip).toHaveAttribute('tabindex', '0');
    }
  });

  it('saves a reorder and keeps the new order on screen', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('First Design');

    await drop(user, 'p1', 'p3');

    await waitFor(() =>
      expect(reorder).toHaveBeenCalledWith('products', [
        { id: 'p2', displayOrder: 1 },
        { id: 'p3', displayOrder: 2 },
        { id: 'p1', displayOrder: 3 },
      ]),
    );
    expect(await screen.findByText('Display order saved.')).toBeInTheDocument();
    await waitFor(() => expect(rowNames()).toEqual(['Second Design', 'Third Design', 'First Design']));
  });

  it('shows a saving indicator and blocks a second request while saving', async () => {
    let finish: (value: { success: true; updated: number }) => void = () => undefined;
    reorder.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderList();
    await screen.findByText('First Design');

    await drop(user, 'p1', 'p2');

    expect(await screen.findByText(/Saving the new order/)).toBeInTheDocument();
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(handle('Third Design')).toBeDisabled();

    finish({ success: true, updated: 3 });
    expect(await screen.findByText('Display order saved.')).toBeInTheDocument();
    await waitFor(() => expect(handle('Third Design')).toBeEnabled());
  });

  it('restores the previous order when the API rejects', async () => {
    reorder.mockRejectedValue(new Error('Could not save the new order.'));
    const user = userEvent.setup();
    renderList();
    await screen.findByText('First Design');

    await drop(user, 'p1', 'p3');

    expect(await screen.findByText('Could not save the new order.')).toBeInTheDocument();
    await waitFor(() => expect(rowNames()).toEqual(['First Design', 'Second Design', 'Third Design']));
    expect(handle('First Design')).toBeEnabled();
  });

  it('does not send a reorder when an item is dropped on itself', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('First Design');

    await drop(user, 'p1', 'p1');

    expect(reorder).not.toHaveBeenCalled();
  });

  it('does not send a reorder when the drop target is missing', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('First Design');

    await drop(user, 'p1', null);

    expect(reorder).not.toHaveBeenCalled();
  });

  it('disables sorting while a search is active', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('First Design');

    await user.type(screen.getByLabelText('Search products'), 'silk');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(handle('First Design')).toBeDisabled());
    expect(
      screen.getByText(/Reordering needs the whole catalogue on one page/),
    ).toBeInTheDocument();
  });

  it('disables sorting while a category or status filter is active', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('First Design');

    await user.selectOptions(screen.getByLabelText('Filter by category'), 'Blouses');
    await waitFor(() => expect(handle('First Design')).toBeDisabled());

    await user.selectOptions(screen.getByLabelText('Filter by category'), '');
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'true');
    await waitFor(() => expect(handle('First Design')).toBeDisabled());
  });

  it('disables sorting on a paginated catalogue', async () => {
    list.mockResolvedValue(page(ITEMS, 25));
    renderList();
    await screen.findByText('First Design');

    expect(handle('First Design')).toBeDisabled();
    expect(
      screen.getByText(/Reordering needs the whole catalogue on one page/),
    ).toBeInTheDocument();
  });

  it('disables sorting when the list is sorted by name', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('First Design');

    await user.selectOptions(screen.getByLabelText('Sort catalogue'), 'name:asc');

    await waitFor(() => expect(handle('First Design')).toBeDisabled());
  });
});

describe('reorder row markup', () => {
  it('keeps row actions usable while sorting is disabled', async () => {
    list.mockResolvedValue(page(ITEMS, 25));
    renderList();
    await screen.findByText('First Design');

    const row = screen.getByText('First Design').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole('button', { name: 'Hide First Design' })).toBeEnabled();
    expect(within(row as HTMLElement).getByRole('link', { name: 'Edit First Design' })).toBeInTheDocument();
  });
});
