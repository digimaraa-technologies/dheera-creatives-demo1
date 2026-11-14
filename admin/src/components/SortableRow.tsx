import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';

interface SortableRowProps {
  id: string;
  name: string;
  disabled: boolean;
  loading?: boolean;
  children: ReactNode;
}

/** A table row draggable by its handle; the rest of the row stays clickable. */
export function SortableRow({
  id,
  name,
  disabled,
  loading = false,
  children,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const className = [isDragging ? 'row-dragging' : '', loading ? 'row-loading' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <tr
      ref={setNodeRef}
      className={className || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <td className="drag-cell">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="drag-handle"
          title={disabled ? 'Reordering unavailable' : 'Drag to reorder'}
          aria-label={`Reorder ${name}`}
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      </td>
      {children}
    </tr>
  );
}
