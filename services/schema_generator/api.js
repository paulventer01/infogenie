const express = require('express');
const router = express.Router();
const _db = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[schema-generator]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

// Field manifest — drives the dynamic frontend form per type.
// kind ∈ text|url|textarea|date|number|email|tel|repeat (repeat = array of objects)
const TYPES = {
  Organization: {
    label: 'Organization',
    fields: [
      { key: 'name',        kind: 'text',     required: true,  placeholder: 'Acme Inc.' },
      { key: 'url',         kind: 'url',      required: true,  placeholder: 'https://acme.com' },
      { key: 'logoUrl',     kind: 'url',                       placeholder: 'https://acme.com/logo.png' },
      { key: 'description', kind: 'textarea',                  placeholder: 'One-line summary of what you do' },
      { key: 'sameAs',      kind: 'repeat', subKey: 'url',     placeholder: 'https://twitter.com/acme', help: 'Social profile URLs (one per row)' },
      { key: 'phone',       kind: 'tel',                       placeholder: '+1-555-555-5555' },
      { key: 'email',       kind: 'email',                     placeholder: 'hello@acme.com' }
    ]
  },
  Article: {
    label: 'Article / BlogPosting',
    fields: [
      { key: 'headline',       kind: 'text',     required: true, placeholder: 'How we 10x\'d our pipeline' },
      { key: 'authorName',     kind: 'text',     required: true, placeholder: 'Jane Smith' },
      { key: 'datePublished',  kind: 'date',     required: true },
      { key: 'dateModified',   kind: 'date' },
      { key: 'image',          kind: 'url',                      placeholder: 'https://acme.com/hero.jpg' },
      { key: 'description',    kind: 'textarea' },
      { key: 'publisherName',  kind: 'text',                     placeholder: 'Acme Inc.' },
      { key: 'publisherLogo',  kind: 'url' }
    ]
  },
  Product: {
    label: 'Product',
    fields: [
      { key: 'name',         kind: 'text',     required: true },
      { key: 'image',        kind: 'url' },
      { key: 'description',  kind: 'textarea' },
      { key: 'brand',        kind: 'text' },
      { key: 'sku',          kind: 'text' },
      { key: 'price',        kind: 'number',   placeholder: '19.99' },
      { key: 'priceCurrency',kind: 'text',     placeholder: 'USD' },
      { key: 'availability', kind: 'text',     placeholder: 'InStock | OutOfStock | PreOrder' },
      { key: 'ratingValue',  kind: 'number',   placeholder: '4.7' },
      { key: 'ratingCount',  kind: 'number',   placeholder: '142' }
    ]
  },
  FAQPage: {
    label: 'FAQ Page',
    fields: [
      { key: 'questions',    kind: 'repeat', required: true,
        subFields: [{ key: 'question', kind: 'text' }, { key: 'answer', kind: 'textarea' }] }
    ]
  },
  LocalBusiness: {
    label: 'Local Business',
    fields: [
      { key: 'name',          kind: 'text', required: true },
      { key: 'image',         kind: 'url' },
      { key: 'telephone',     kind: 'tel' },
      { key: 'streetAddress', kind: 'text' },
      { key: 'addressLocality', kind: 'text', placeholder: 'City' },
      { key: 'addressRegion', kind: 'text',   placeholder: 'State / Province' },
      { key: 'postalCode',    kind: 'text' },
      { key: 'addressCountry',kind: 'text',   placeholder: 'US / GB / ZA' },
      { key: 'latitude',      kind: 'number' },
      { key: 'longitude',     kind: 'number' },
      { key: 'priceRange',    kind: 'text',   placeholder: '$$' },
      { key: 'openingHours',  kind: 'repeat', subKey: 'spec', placeholder: 'Mo-Fr 09:00-17:00', help: 'Schema.org openingHours format' }
    ]
  },
  BreadcrumbList: {
    label: 'Breadcrumb',
    fields: [
      { key: 'items', kind: 'repeat', required: true,
        subFields: [{ key: 'name', kind: 'text' }, { key: 'url', kind: 'url' }] }
    ]
  },
  Event: {
    label: 'Event',
    fields: [
      { key: 'name',         kind: 'text', required: true },
      { key: 'startDate',    kind: 'date', required: true },
      { key: 'endDate',      kind: 'date' },
      { key: 'locationName', kind: 'text' },
      { key: 'streetAddress',kind: 'text' },
      { key: 'addressLocality', kind: 'text' },
      { key: 'addressCountry', kind: 'text' },
      { key: 'image',        kind: 'url' },
      { key: 'description',  kind: 'textarea' },
      { key: 'offerUrl',     kind: 'url' },
      { key: 'offerPrice',   kind: 'number' },
      { key: 'offerCurrency',kind: 'text', placeholder: 'USD' }
    ]
  },
  Recipe: {
    label: 'Recipe',
    fields: [
      { key: 'name',          kind: 'text', required: true },
      { key: 'image',         kind: 'url' },
      { key: 'description',   kind: 'textarea' },
      { key: 'prepTime',      kind: 'text', placeholder: 'PT15M (ISO 8601)' },
      { key: 'cookTime',      kind: 'text', placeholder: 'PT30M' },
      { key: 'recipeYield',   kind: 'text', placeholder: '4 servings' },
      { key: 'recipeIngredient', kind: 'repeat', subKey: 'item', placeholder: '2 cups flour' },
      { key: 'recipeInstructions', kind: 'repeat', subKey: 'step', placeholder: 'Preheat oven to 180°C' }
    ]
  }
};

function _strip(o) {
  // Remove undefined/null/empty-string/empty-array values recursively.
  if (Array.isArray(o)) {
    const arr = o.map(_strip).filter(v => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o)) {
      const v = _strip(o[k]);
      if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return (o === '' || o === null || o === undefined) ? undefined : o;
}

function _arr(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  return [v];
}

function _build(type, f) {
  const base = { '@context': 'https://schema.org', '@type': type };
  switch (type) {
    case 'Organization': {
      const o = { ...base, name: f.name, url: f.url, logo: f.logoUrl, description: f.description, telephone: f.phone, email: f.email };
      const same = _arr(f.sameAs).map(x => typeof x === 'object' ? (x.url || x.value) : x).filter(Boolean);
      if (same.length) o.sameAs = same;
      return o;
    }
    case 'Article': {
      const o = { ...base, headline: f.headline, datePublished: f.datePublished, dateModified: f.dateModified || f.datePublished,
        image: f.image, description: f.description };
      if (f.authorName) o.author = { '@type': 'Person', name: f.authorName };
      if (f.publisherName) o.publisher = { '@type': 'Organization', name: f.publisherName, logo: f.publisherLogo ? { '@type': 'ImageObject', url: f.publisherLogo } : undefined };
      return o;
    }
    case 'Product': {
      const o = { ...base, name: f.name, image: f.image, description: f.description, sku: f.sku };
      if (f.brand) o.brand = { '@type': 'Brand', name: f.brand };
      if (f.price) o.offers = { '@type': 'Offer', price: String(f.price), priceCurrency: f.priceCurrency || 'USD',
        availability: f.availability ? `https://schema.org/${f.availability}` : 'https://schema.org/InStock' };
      if (f.ratingValue) o.aggregateRating = { '@type': 'AggregateRating', ratingValue: String(f.ratingValue), reviewCount: String(f.ratingCount || 1) };
      return o;
    }
    case 'FAQPage': {
      const items = _arr(f.questions).map(q => ({
        '@type': 'Question', name: q.question || '',
        acceptedAnswer: { '@type': 'Answer', text: q.answer || '' }
      })).filter(q => q.name && q.acceptedAnswer.text);
      return { ...base, mainEntity: items };
    }
    case 'LocalBusiness': {
      const o = { ...base, name: f.name, image: f.image, telephone: f.telephone, priceRange: f.priceRange };
      if (f.streetAddress || f.addressLocality) o.address = { '@type': 'PostalAddress',
        streetAddress: f.streetAddress, addressLocality: f.addressLocality, addressRegion: f.addressRegion,
        postalCode: f.postalCode, addressCountry: f.addressCountry };
      if (f.latitude && f.longitude) o.geo = { '@type': 'GeoCoordinates', latitude: f.latitude, longitude: f.longitude };
      const hrs = _arr(f.openingHours).map(x => typeof x === 'object' ? (x.spec || x.value) : x).filter(Boolean);
      if (hrs.length) o.openingHours = hrs;
      return o;
    }
    case 'BreadcrumbList': {
      const items = _arr(f.items).map((it, i) => ({
        '@type': 'ListItem', position: i + 1, name: it.name, item: it.url
      })).filter(it => it.name);
      return { ...base, itemListElement: items };
    }
    case 'Event': {
      const o = { ...base, name: f.name, startDate: f.startDate, endDate: f.endDate, image: f.image, description: f.description };
      if (f.locationName) o.location = { '@type': 'Place', name: f.locationName,
        address: (f.streetAddress || f.addressLocality) ? { '@type': 'PostalAddress', streetAddress: f.streetAddress, addressLocality: f.addressLocality, addressCountry: f.addressCountry } : undefined };
      if (f.offerUrl || f.offerPrice) o.offers = { '@type': 'Offer', url: f.offerUrl, price: f.offerPrice ? String(f.offerPrice) : undefined, priceCurrency: f.offerCurrency || 'USD', availability: 'https://schema.org/InStock' };
      return o;
    }
    case 'Recipe': {
      const o = { ...base, name: f.name, image: f.image, description: f.description,
        prepTime: f.prepTime, cookTime: f.cookTime, recipeYield: f.recipeYield };
      const ing = _arr(f.recipeIngredient).map(x => typeof x === 'object' ? (x.item || x.value) : x).filter(Boolean);
      if (ing.length) o.recipeIngredient = ing;
      const steps = _arr(f.recipeInstructions).map(x => typeof x === 'object' ? (x.step || x.value) : x).filter(Boolean);
      if (steps.length) o.recipeInstructions = steps.map(s => ({ '@type': 'HowToStep', text: s }));
      return o;
    }
    default: return base;
  }
}

router.get('/test', (req, res) => res.json({ ok: true, db: _db.hasDb && _db.hasDb(), types: Object.keys(TYPES) }));

router.get('/types', (req, res) => res.json({ ok: true, types: TYPES }));

router.post('/generate', _safeAsync(async (req, res) => {
  const type = String(req.body?.type || '').trim();
  if (!TYPES[type]) return _err(res, 400, 'Unknown type. Allowed: ' + Object.keys(TYPES).join(', '));
  const fields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
  const required = TYPES[type].fields.filter(f => f.required).map(f => f.key);
  const missing = required.filter(k => !fields[k] || (Array.isArray(fields[k]) && !fields[k].length));
  if (missing.length) return _err(res, 400, 'Missing required fields: ' + missing.join(', '));
  const obj = _strip(_build(type, fields));
  const jsonld = `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
  res.json({ ok: true, type, jsonld, object: obj });
}));

router.post('/save', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const type = String(req.body?.type || '').trim();
  if (!TYPES[type]) return _err(res, 400, 'Unknown type');
  const name = String(req.body?.name || '').trim().slice(0, 200) || `${type} block`;
  const fields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
  // Same required-field validation as /generate — never persist a malformed block.
  const required = TYPES[type].fields.filter(f => f.required).map(f => f.key);
  const missing = required.filter(k => !fields[k] || (Array.isArray(fields[k]) && !fields[k].length));
  if (missing.length) return _err(res, 400, 'Missing required fields: ' + missing.join(', '));
  const obj = _strip(_build(type, fields));
  const jsonld = `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
  const r = await _db.getPool().query(
    `INSERT INTO schema_blocks (name, type, fields, jsonld) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
    [name, type, JSON.stringify(fields), jsonld]
  );
  res.json({ ok: true, id: r.rows[0].id, name, type, jsonld, created_at: r.rows[0].created_at });
}));

router.get('/list', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, blocks: [] });
  const r = await _db.getPool().query(`SELECT id, name, type, fields, jsonld, created_at FROM schema_blocks ORDER BY created_at DESC LIMIT 100`);
  res.json({ ok: true, blocks: r.rows });
}));

router.delete('/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  await _db.getPool().query(`DELETE FROM schema_blocks WHERE id=$1`, [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

module.exports = router;
