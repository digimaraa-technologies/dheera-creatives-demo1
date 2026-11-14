/* ==========================================================================
   Dheera Creatives — catalogue helpers shared by the public site and tests.
   DOM-free and dependency-free so the data rules can be tested in Node.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.DheeraCatalogCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Only same-origin media the site itself serves: uploaded catalogue images
  // and the bundled assets. Anything else (javascript:, data:, external hosts)
  // is rejected before it can reach an <img> tag.
  var IMAGE_PATH_PATTERN = /^\/(uploads|assets)\//;
  var MAX_IMAGE_URL_LENGTH = 2048;

  function safeImageUrl(value, origin) {
    if (typeof value !== 'string') return '';

    var raw = value.trim();
    if (!raw || raw.length > MAX_IMAGE_URL_LENGTH) return '';
    if (/[\u0000-\u001f\u007f]/.test(raw)) return '';

    var base;
    var url;
    try {
      base = new URL(origin || 'http://localhost');
      url = new URL(raw, base);
    } catch (error) {
      return '';
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.origin !== base.origin) return '';
    if (!IMAGE_PATH_PATTERN.test(url.pathname)) return '';

    return url.pathname + url.search;
  }

  function toPrice(value) {
    if (value === null || value === undefined || value === '') return null;
    var number = Number(value);
    return isFinite(number) && number >= 0 ? number : null;
  }

  function formatPrice(value) {
    if (typeof value !== 'number' || !isFinite(value) || value < 0) return '';
    try {
      return '\u20B9' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
    } catch (error) {
      return '\u20B9' + value;
    }
  }

  function normalizeItems(items, type, origin) {
    if (!Array.isArray(items)) return [];

    var kind = type === 'service' ? 'service' : 'product';
    var result = [];

    items.forEach(function (item) {
      if (!item || item.isActive === false) return;

      var name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) return;

      result.push({
        type: kind,
        id: item.id == null ? '' : String(item.id),
        name: name,
        description: typeof item.description === 'string' ? item.description.trim() : '',
        category: typeof item.category === 'string' ? item.category.trim() : '',
        imageUrl: safeImageUrl(item.imageUrl, origin),
        price: toPrice(item.price),
        displayOrder: toPrice(item.displayOrder) || 0
      });
    });

    return result;
  }

  function compareItems(a, b) {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;

    var byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;

    if (a.type !== b.type) return a.type === 'product' ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  // Decides what the grid shows. A failed products request falls back to the
  // static cards already in the markup; a successful empty response does not.
  function resolveCatalog(input) {
    var options = input || {};
    var productsOk = Boolean(options.products && options.products.ok);
    var servicesOk = Boolean(options.services && options.services.ok);

    var items = [];
    if (productsOk) {
      items = items.concat(normalizeItems(options.products.items, 'product', options.origin));
    }
    if (servicesOk) {
      items = items.concat(normalizeItems(options.services.items, 'service', options.origin));
    }
    items.sort(compareItems);

    var useFallback = !productsOk && Boolean(options.hasFallback);

    if (items.length) {
      return { mode: 'render', items: items, useFallback: useFallback };
    }
    if (productsOk && servicesOk) {
      return { mode: 'empty', items: items, useFallback: false };
    }
    return { mode: useFallback ? 'fallback' : 'empty', items: items, useFallback: false };
  }

  function buildWhatsAppUrl(options) {
    var opts = options || {};
    var digits = String(opts.whatsapp == null ? '' : opts.whatsapp).replace(/[^\d]/g, '');
    if (!digits) return '';

    var template = typeof opts.template === 'string' && opts.template
      ? opts.template
      : 'I would like to enquire about {name}.';

    var message = template
      .split('{name}').join(String(opts.name == null ? '' : opts.name))
      .split('{url}').join(String(opts.url == null ? '' : opts.url));

    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message);
  }

  return {
    safeImageUrl: safeImageUrl,
    formatPrice: formatPrice,
    normalizeItems: normalizeItems,
    compareItems: compareItems,
    resolveCatalog: resolveCatalog,
    buildWhatsAppUrl: buildWhatsAppUrl
  };
});
