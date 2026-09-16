const clean = (value, max = 180) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normalize = (value) => clean(value, 400).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

const INTERNAL_EXACT = new Set((
  'meaning meanings subject subjects event events context contexts summary summaries analysis analyses semantic semantics narrative narratives '+
  'topic topics label labels title titles description descriptions understanding result results output outputs unknown unspecified none null'
).split(/\s+/));

const INTERNAL_CONTAINER = new Set((
  'meaning meanings subject subjects event events context contexts summary summaries analysis analyses semantic semantics narrative narratives '+
  'topic topics label labels title titles description descriptions understanding result results output outputs field fields value values '+
  'content contents post posts video videos image images media data metadata'
).split(/\s+/));

export function normalizeSemanticLabel(value) {
  return normalize(value);
}

export function isInternalSemanticLabel(value) {
  const normalized = normalize(value);
  if (!normalized) return true;
  if (INTERNAL_EXACT.has(normalized)) return true;
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length <= 3 && parts.every((part) => INTERNAL_CONTAINER.has(part));
}

export function preferSpecificSemanticLabel(primary, fallback = '') {
  const first = clean(primary);
  if (first && !isInternalSemanticLabel(first)) return first;
  const second = clean(fallback);
  if (second && !isInternalSemanticLabel(second)) return second;
  return '';
}
