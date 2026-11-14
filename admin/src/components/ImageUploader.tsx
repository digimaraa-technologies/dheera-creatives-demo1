import { ImagePlus, X } from 'lucide-react';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ImageUploaderProps {
  previewUrl: string | null;
  fileName: string | null;
  disabled?: boolean;
  onSelect(file: File | null): void;
}

export function ImageUploader({ previewUrl, fileName, disabled, onSelect }: ImageUploaderProps) {
  return (
    <div className="image-uploader">
      <div className="image-preview">
        {previewUrl ? (
          <img src={previewUrl} alt="Selected preview" />
        ) : (
          <span className="image-placeholder">
            <ImagePlus size={26} aria-hidden="true" />
            No image
          </span>
        )}
      </div>
      <div className="image-controls">
        <label className="btn btn-ghost btn-sm upload-button">
          {previewUrl ? 'Replace image' : 'Choose image'}
          <input
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            disabled={disabled}
            aria-label="Image file"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onSelect(file);
              event.target.value = '';
            }}
          />
        </label>
        {fileName && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(null)}>
            <X size={14} aria-hidden="true" />
            Remove
          </button>
        )}
        <p className="hint">
          {fileName ?? 'JPEG, PNG, WebP or AVIF · 5 MB maximum'}
        </p>
      </div>
    </div>
  );
}
