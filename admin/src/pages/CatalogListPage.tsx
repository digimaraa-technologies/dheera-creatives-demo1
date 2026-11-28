import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  GripVertical,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { catalogApi } from '../api/catalog';
import { assetUrl } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { SortableRow } from '../components/SortableRow';
import { useToast } from '../hooks/useToast';
import { formatPrice } from '../lib/format';
import {
  canReorderCatalog,
  moveItem,
  reorderPayload,
  withDisplayOrder,
} from '../lib/reorder';
import type {
  CatalogItem,
  CatalogKind,
  CatalogQuery,
  Paginated,
  SortDir,
  SortField,
} from '../types';

const PAGE_SIZE = 10;
const REORDER_PAGE_SIZE = 500;

const INITIAL_QUERY: CatalogQuery = {
  page: 1,
  pageSize: PAGE_SIZE,
  search: '',
  category: '',
  isActive: '',
  sortBy: 'displayOrder',
  sortDir: 'asc',
};

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'displayOrder:asc', label: 'Display order (low to high)' },
  { value: 'displayOrder:desc', label: 'Display order (high to low)' },
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
];

const LABELS = {
  products: {
    singular: 'product',
    plural: 'Products',
    description: 'Product entries shown on the public site.',
  },
  services: {
    singular: 'service',
    plural: 'Services',
    description: 'Service entries shown on the public site.',
  },
} as const;

export function CatalogListPage({ kind }: { kind: CatalogKind }) {
  const labels = LABELS[kind];
  const [query, setQuery] = useState<CatalogQuery>(INITIAL_QUERY);
  const [searchInput, setSearchInput] = useState('');
  const [data, setData] = useState<Paginated<CatalogItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { notify } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    catalogApi
      .list(kind, query)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load the catalogue.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [kind, query]);

  function patchQuery(patch: Partial<CatalogQuery>) {
    setQuery((current) => ({ ...current, ...patch }));
  }

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    patchQuery({ search: searchInput.trim(), page: 1 });
  }

  async function toggleActive(item: CatalogItem) {
    setPendingId(item.id);
    try {
      const updated = await catalogApi.update(kind, item.id, { isActive: !item.isActive });
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) => (row.id === item.id ? updated : row)),
            }
          : current,
      );
      notify(`${item.name} ${updated.isActive ? 'is now visible' : 'is now hidden'}.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not change status.', 'error');
    } finally {
      setPendingId(null);
    }
  }

  async function confirmDelete() {
    if (!confirming) return;
    setDeleting(true);
    try {
      await catalogApi.remove(kind, confirming.id);
      notify(`${confirming.name} deleted.`);
      setConfirming(null);
      if (data && data.items.length === 1 && query.page > 1) {
        patchQuery({ page: query.page - 1 });
      } else {
        setQuery((current) => ({ ...current }));
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete the record.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function persistOrder(nextItems: CatalogItem[]) {
    if (!data || savingOrder) return;

    const previous = data;
    const optimistic = withDisplayOrder(nextItems);
    setData({ ...data, items: optimistic });
    setSavingOrder(true);

    try {
      await catalogApi.reorder(kind, reorderPayload(optimistic));
      notify('Display order saved.');
    } catch (err) {
      // Put the rows back exactly where they were before the drag.
      setData(previous);
      notify(err instanceof Error ? err.message : 'Could not save the new order.', 'error');
    } finally {
      setSavingOrder(false);
    }
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!data) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = data.items.findIndex((item) => item.id === active.id);
    const to = data.items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;

    void persistOrder(moveItem(data.items, from, to));
  }

  const sortable = canReorderCatalog(query, data);
  const dragDisabled = !sortable || savingOrder || pendingId !== null || deleting;
  const canShowAllToReorder =
    !sortable && data !== null && data.total > 1 && data.total <= REORDER_PAGE_SIZE;
  const activeItem = activeId
    ? (data?.items.find((item) => item.id === activeId) ?? null)
    : null;

  function enterReorderMode() {
    setSearchInput('');
    setQuery({
      ...INITIAL_QUERY,
      pageSize: REORDER_PAGE_SIZE,
    });
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h2>{labels.plural}</h2>
          <p>{labels.description}</p>
        </div>
        <Link to={`/${kind}/new`} className="btn btn-primary">
          <Plus size={17} aria-hidden="true" />
          Add {labels.singular}
        </Link>
      </div>

      <form className="filters" onSubmit={onSearch}>
        <div className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder={`Search ${kind} by name`}
            aria-label={`Search ${kind}`}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <select
          aria-label="Filter by category"
          value={query.category}
          onChange={(event) => patchQuery({ category: event.target.value, page: 1 })}
        >
          <option value="">All categories</option>
          {(data?.categories ?? []).map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          value={query.isActive}
          onChange={(event) =>
            patchQuery({ isActive: event.target.value as CatalogQuery['isActive'], page: 1 })
          }
        >
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>

        <select
          aria-label="Sort catalogue"
          value={`${query.sortBy}:${query.sortDir}`}
          onChange={(event) => {
            const [sortBy, sortDir] = event.target.value.split(':');
            patchQuery({
              sortBy: sortBy as SortField,
              sortDir: sortDir as SortDir,
              page: 1,
            });
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button type="submit" className="btn btn-ghost">
          Search
        </button>
      </form>

      {error && (
        <div className="error-state">
          <p>{error}</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setQuery((current) => ({ ...current }))}
          >
            Try again
          </button>
        </div>
      )}

      {!error && loading && !data && (
        <div className="table-card" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="skeleton-row">
              <span className="skeleton skeleton-thumb" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line short" />
            </div>
          ))}
        </div>
      )}

      {!error && data && data.total === 0 && (
        <EmptyState
          title={`No ${kind} found`}
          description={
            query.search || query.category || query.isActive
              ? 'Try clearing the filters, or add a new entry.'
              : `Add your first ${labels.singular} to get started.`
          }
          action={
            <Link to={`/${kind}/new`} className="btn btn-primary">
              Add {labels.singular}
            </Link>
          }
        />
      )}

      {!error && data && data.total > 1 && (
        <div className="hint reorder-hint" role="status" aria-live="polite">
          {savingOrder ? (
            <>
              <span className="spinner spinner-inline" aria-hidden="true" />
              Saving the new order…
            </>
          ) : sortable ? (
            <>
              <span>Drag a row by its handle to change the order. Changes save automatically.</span>
              {query.pageSize > PAGE_SIZE && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => patchQuery({ pageSize: PAGE_SIZE, page: 1 })}
                >
                  Back to 10 per page
                </button>
              )}
            </>
          ) : (
            <>
              <span>
                Reordering needs the whole catalogue on one page, sorted by display order, with no
                search or filters.
              </span>
              {canShowAllToReorder && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={enterReorderMode}>
                  Show all to reorder
                </button>
              )}
            </>
          )}
        </div>
      )}

      {!error && data && data.total > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="table-card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="drag-head" aria-label="Reorder" />
                    <th scope="col">Image</th>
                    <th scope="col">Name</th>
                    <th scope="col">Category</th>
                    <th scope="col">Price</th>
                    <th scope="col">Order</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="actions-head">
                      Actions
                    </th>
                  </tr>
                </thead>
                <SortableContext
                  items={data.items.map((item) => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <tbody>
                    {data.items.map((item) => (
                      <SortableRow
                        key={item.id}
                        id={item.id}
                        name={item.name}
                        disabled={dragDisabled}
                        loading={loading}
                      >
                        <td>
                          <img
                            className="thumb"
                            src={assetUrl(item.imageUrl)}
                            alt=""
                            loading="lazy"
                            width={56}
                            height={56}
                          />
                        </td>
                        <td>
                          <strong className="cell-title">{item.name}</strong>
                          <span className="cell-sub">/{item.slug}</span>
                        </td>
                        <td>{item.category}</td>
                        <td>{formatPrice(item.price)}</td>
                        <td>{item.displayOrder}</td>
                        <td>
                          <span
                            className={
                              item.isActive ? 'badge badge-active' : 'badge badge-inactive'
                            }
                          >
                            {item.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link
                              to={`/${kind}/${item.id}/edit`}
                              className="icon-btn"
                              aria-label={`Edit ${item.name}`}
                              title="Edit"
                            >
                              <Pencil size={16} />
                            </Link>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={
                                item.isActive ? `Hide ${item.name}` : `Show ${item.name}`
                              }
                              title={item.isActive ? 'Hide from site' : 'Show on site'}
                              disabled={pendingId === item.id || savingOrder}
                              onClick={() => void toggleActive(item)}
                            >
                              {item.isActive ? <PowerOff size={16} /> : <Power size={16} />}
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              aria-label={`Delete ${item.name}`}
                              title="Delete"
                              disabled={savingOrder}
                              onClick={() => setConfirming(item)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </SortableRow>
                    ))}
                  </tbody>
                </SortableContext>
              </table>
            </div>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              onChange={(page) => patchQuery({ page })}
            />
          </div>

          <DragOverlay>
            {activeItem ? (
              <div className="drag-preview">
                <GripVertical size={16} aria-hidden="true" />
                <span className="cell-title">{activeItem.name}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Delete ${labels.singular}?`}
          message={`"${confirming.name}" and its uploaded image will be removed. This cannot be undone.`}
          busy={deleting}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
