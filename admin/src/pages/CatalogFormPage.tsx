import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { catalogApi } from '../api/catalog';
import { ApiError, assetUrl } from '../api/client';
import {
  ACCEPTED_IMAGE_TYPES,
  ImageUploader,
  MAX_IMAGE_BYTES,
} from '../components/ImageUploader';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../hooks/useToast';
import { slugify } from '../lib/format';
import type { CatalogInput, CatalogItem, CatalogKind } from '../types';

const LABELS = {
  products: { singular: 'product', plural: 'Products' },
  services: { singular: 'service', plural: 'Services' },
} as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function CatalogFormPage({ kind }: { kind: CatalogKind }) {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const labels = LABELS[kind];
  const navigate = useNavigate();
  const { notify } = useToast();

  const [existing, setExisting] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [isActive, setIsActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadsEnabled, setUploadsEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    catalogApi
      .uploadStatus?.()
      .then((status) => {
        if (active && status) setUploadsEnabled(status.enabled);
      })
      .catch(() => {
        // Keep form usable if status probe is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let active = true;

    catalogApi
      .get(kind, id)
      .then((item) => {
        if (!active) return;
        setExisting(item);
        setName(item.name);
        setSlug(item.slug);
        setSlugEdited(true);
        setDescription(item.description);
        setCategory(item.category);
        setPrice(item.price === null ? '' : String(item.price));
        setDisplayOrder(String(item.displayOrder));
        setIsActive(item.isActive);
        setPreview(assetUrl(item.imageUrl));
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadError(err instanceof Error ? err.message : `Could not load this ${labels.singular}.`);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [kind, id, labels.singular]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onNameChange(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  function onFileSelect(selected: File | null) {
    if (!selected) {
      setFile(null);
      setPreview(existing ? assetUrl(existing.imageUrl) : null);
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(selected.type)) {
      setFieldErrors((current) => ({
        ...current,
        image: 'Use a JPEG, PNG, WebP or AVIF image.',
      }));
      return;
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      setFieldErrors((current) => ({ ...current, image: 'Images must be 5 MB or smaller.' }));
      return;
    }
    setFieldErrors((current) => {
      const { image: _image, ...rest } = current;
      return rest;
    });
    setFile(selected);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const errors: Record<string, string> = {};
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const trimmedCategory = category.trim();
    const trimmedSlug = slug.trim();

    if (!trimmedName) errors.name = 'Name is required.';
    else if (trimmedName.length > 160) errors.name = 'Name must be 160 characters or fewer.';

    if (!trimmedDescription) errors.description = 'Description is required.';
    else if (trimmedDescription.length > 5000) {
      errors.description = 'Description must be 5000 characters or fewer.';
    }

    if (!trimmedCategory) errors.category = 'Category is required.';
    else if (trimmedCategory.length > 80) {
      errors.category = 'Category must be 80 characters or fewer.';
    }

    if (trimmedSlug && !SLUG_PATTERN.test(trimmedSlug)) {
      errors.slug = 'Use lowercase letters, numbers and hyphens only.';
    }

    const priceValue = price.trim() === '' ? null : Number(price);
    if (priceValue !== null && (!Number.isFinite(priceValue) || priceValue < 0)) {
      errors.price = 'Price must be zero or more.';
    } else if (priceValue !== null && Math.round(priceValue * 100) !== priceValue * 100) {
      errors.price = 'Price can have at most 2 decimal places.';
    }

    const orderValue = Number(displayOrder.trim() === '' ? '0' : displayOrder);
    if (!Number.isInteger(orderValue)) {
      errors.displayOrder = 'Display order must be a whole number.';
    }

    if (!existing && !file) errors.image = 'Choose an image.';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      let image = existing
        ? { imageUrl: existing.imageUrl, imageFilename: existing.imageFilename ?? undefined }
        : null;

      if (file) {
        const uploaded = await catalogApi.upload(kind, file);
        image = uploaded;
      }

      const payload: CatalogInput = {
        name: trimmedName,
        slug: trimmedSlug || undefined,
        description: trimmedDescription,
        category: trimmedCategory,
        imageUrl: image!.imageUrl,
        imageFilename: image!.imageFilename,
        price: priceValue,
        displayOrder: orderValue,
        isActive,
      };

      if (isEdit && id) {
        await catalogApi.update(kind, id, payload);
      } else {
        await catalogApi.create(kind, payload);
      }

      notify(`${isEdit ? 'Updated' : 'Created'} ${labels.singular} "${trimmedName}".`);
      navigate(`/${kind}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setUploadsEnabled(false);
        setError(
          'Production image uploads are unavailable until durable storage is configured.',
        );
      } else {
        setError(
          err instanceof Error ? err.message : `Could not save this ${labels.singular}.`,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingSpinner />;

  if (loadError) {
    return (
      <div className="error-state">
        <p>{loadError}</p>
        <Link to={`/${kind}`} className="btn btn-ghost btn-sm">
          Back to {labels.plural.toLowerCase()}
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <Link to={`/${kind}`} className="back-link">
            <ArrowLeft size={15} aria-hidden="true" />
            Back to {labels.plural.toLowerCase()}
          </Link>
          <h2>{isEdit ? `Edit ${labels.singular}` : `Add ${labels.singular}`}</h2>
          <p>
            {isEdit
              ? 'Changes go live on the public site as soon as they are saved.'
              : `Create a new ${labels.singular} entry for the public site.`}
          </p>
        </div>
      </div>

      {!uploadsEnabled && (
        <div className="alert alert-warning" role="status">
          Image uploads are disabled in production until durable storage is configured.
          {isEdit
            ? ' You can still update text fields, visibility, or order.'
            : ' New entries cannot be created without image storage.'}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <form className="card form-card" onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              value={name}
              maxLength={160}
              onChange={(event) => onNameChange(event.target.value)}
              disabled={saving}
            />
            {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
          </div>

          <div className="field">
            <label htmlFor="slug">URL slug</label>
            <input
              id="slug"
              value={slug}
              maxLength={160}
              onChange={(event) => {
                setSlug(event.target.value);
                setSlugEdited(true);
              }}
              disabled={saving}
            />
            <span className="hint">
              Generated from the name. Lowercase letters, numbers and hyphens only.
            </span>
            {fieldErrors.slug && <span className="field-error">{fieldErrors.slug}</span>}
          </div>

          <div className="field">
            <label htmlFor="category">Category</label>
            <input
              id="category"
              value={category}
              maxLength={80}
              onChange={(event) => setCategory(event.target.value)}
              disabled={saving}
            />
            {fieldErrors.category && <span className="field-error">{fieldErrors.category}</span>}
          </div>

          <div className="field">
            <label htmlFor="price">Price (INR)</label>
            <input
              id="price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              disabled={saving}
              placeholder="Leave empty to hide the price"
            />
            {fieldErrors.price && <span className="field-error">{fieldErrors.price}</span>}
          </div>

          <div className="field">
            <label htmlFor="displayOrder">Display order</label>
            <input
              id="displayOrder"
              type="number"
              step="1"
              value={displayOrder}
              onChange={(event) => setDisplayOrder(event.target.value)}
              disabled={saving}
            />
            <span className="hint">Lower numbers appear first.</span>
            {fieldErrors.displayOrder && (
              <span className="field-error">{fieldErrors.displayOrder}</span>
            )}
          </div>

          <div className="field checkbox-field">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={saving}
              />
              <span>Visible on the public site</span>
            </label>
          </div>

          <div className="field full">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              rows={5}
              maxLength={5000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={saving}
            />
            {fieldErrors.description && (
              <span className="field-error">{fieldErrors.description}</span>
            )}
          </div>

          <div className="field full">
            <label>Image</label>
            <ImageUploader
              previewUrl={preview}
              fileName={file?.name ?? null}
              disabled={saving || !uploadsEnabled}
              onSelect={onFileSelect}
            />
            {fieldErrors.image && <span className="field-error">{fieldErrors.image}</span>}
          </div>
        </div>

        <div className="form-actions">
          <Link to={`/${kind}`} className="btn btn-ghost">
            Cancel
          </Link>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || (!isEdit && !uploadsEnabled)}
          >
            <Save size={16} aria-hidden="true" />
            {saving ? 'Saving…' : isEdit ? 'Save changes' : `Create ${labels.singular}`}
          </button>
        </div>
      </form>
    </div>
  );
}
