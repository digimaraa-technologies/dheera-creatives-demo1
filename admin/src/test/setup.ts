import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not implement object URLs; the uploader uses them for previews.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:preview';
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => undefined;
}

afterEach(() => {
  cleanup();
  document.cookie = 'dheera_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});
