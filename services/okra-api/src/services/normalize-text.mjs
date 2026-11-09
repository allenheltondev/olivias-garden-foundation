/**
 * Title-case normalization for names and addresses typed into okra forms.
 *
 * People type "JOHN SMITH", "john smith" or "123 main st". We store them as
 * "John Smith" and "123 Main St". The rules are deliberately conservative:
 *
 *   - A word that is all lower or all upper case is re-cased.
 *   - A word that already mixes case ("DeShawn", "McDonald", "O'Neil") is
 *     trusted: only its first letter is forced up.
 *   - Emails are never touched.
 *
 * Both functions are idempotent: normalizing a normalized value is a no-op.
 */

const NAME_PARTICLES = new Set([
  'van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'dos', 'du',
  'la', 'bin', 'ibn'
]);
const ADDRESS_SMALL_WORDS = new Set(['of', 'the', 'and']);
const NAME_SUFFIXES = new Map([
  ['jr', 'Jr'], ['sr', 'Sr'],
  ['ii', 'II'], ['iii', 'III'], ['iv', 'IV'], ['v', 'V']
]);
const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const ADDRESS_ACRONYMS = new Set(['PO', 'APO', 'FPO', 'DPO', 'US', 'USA', 'RR', 'HC']);
const ORDINAL = /^(\d+)(st|nd|rd|th)$/i;

function upperFirst(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function isSingleCase(word) {
  return word === word.toLowerCase() || word === word.toUpperCase();
}

/** "mary-jane" → "Mary-Jane", "o'brien" → "O'Brien", "mcdonald" → "McDonald". */
function capitalizeSegments(word) {
  return word
    .toLowerCase()
    .split(/([-'’])/)
    .map((part, index, parts) => {
      if (part === '-' || part === "'" || part === '’') return part;
      // "d'angelo" and friends: a lone leading letter then an apostrophe.
      if (!part) return part;
      // "mary's" / "don't": a lone letter after an apostrophe stays lower case.
      if (index > 0 && /['’]/.test(parts[index - 1]) && part.length === 1) return part;
      const cased = upperFirst(part);
      // Only treat "mc" as a prefix at the start of a segment, and only when
      // something follows it ("Mc" alone isn't a name).
      if (index === 0 || parts[index - 1] === '-') {
        const mc = /^Mc([a-z]{2,})$/.exec(cased);
        if (mc) return `Mc${upperFirst(mc[1])}`;
      }
      return cased;
    })
    .join('');
}

function splitTokens(value) {
  return value.trim().split(/\s+/).filter(Boolean);
}

/** Initials like "j.r." or "j." → "J.R." / "J.". */
function isInitials(word) {
  return /^(?:[A-Za-z]\.){1,4}$/.test(word);
}

function normalizeNameWord(word, index, isLast) {
  if (isInitials(word)) return word.toUpperCase();

  const bare = word.replace(/[.,]+$/, '');
  const trailing = word.slice(bare.length);
  const lower = bare.toLowerCase();

  if (index > 0 && NAME_SUFFIXES.has(lower)) {
    return `${NAME_SUFFIXES.get(lower)}${trailing}`;
  }
  // Particles stay lower case mid-name, but a final one is a surname ("La").
  if (index > 0 && !isLast && NAME_PARTICLES.has(lower) && isSingleCase(bare)) {
    return `${lower}${trailing}`;
  }
  if (isSingleCase(bare)) {
    return `${capitalizeSegments(bare)}${trailing}`;
  }
  return `${upperFirst(bare)}${trailing}`;
}

/**
 * Normalize a person's name. Non-strings and anything that looks like an email
 * address (the contributor name sometimes falls back to one) pass through.
 */
export function normalizeName(value) {
  if (typeof value !== 'string') return value;
  if (value.includes('@')) return value.trim();
  const words = splitTokens(value);
  return words
    .map((word, index) => normalizeNameWord(word, index, index === words.length - 1))
    .join(' ');
}

function normalizeAddressWord(word, index, afterComma) {
  const bare = word.replace(/[.,;]+$/, '');
  const trailing = word.slice(bare.length);
  if (!bare) return word;
  const upper = bare.toUpperCase();

  if (ORDINAL.test(bare)) return `${bare.slice(0, -2)}${bare.slice(-2).toLowerCase()}${trailing}`;
  if (DIRECTIONALS.has(upper) && isSingleCase(bare)) return `${upper}${trailing}`;
  if (ADDRESS_ACRONYMS.has(upper) && isSingleCase(bare)) return `${upper}${trailing}`;
  // "Austin, tx" → "Austin, TX"
  if (afterComma && /^[A-Za-z]{2}$/.test(bare) && isSingleCase(bare)) return `${upper}${trailing}`;
  // Unit designators such as "#4b" or "4B": keep digits, uppercase letters.
  if (/^#?\d+[A-Za-z]$/.test(bare) && isSingleCase(bare)) return `${upper}${trailing}`;
  if (index > 0 && ADDRESS_SMALL_WORDS.has(bare.toLowerCase()) && isSingleCase(bare)) {
    return `${bare.toLowerCase()}${trailing}`;
  }
  if (!/[A-Za-z]/.test(bare)) return word;
  if (isSingleCase(bare)) return `${capitalizeSegments(bare)}${trailing}`;
  return `${upperFirst(bare)}${trailing}`;
}

/**
 * Normalize a street line, city, region name or free-text location.
 * Two-letter words after a comma ("Austin, tx") are treated as state/province
 * codes and upper-cased.
 */
export function normalizeAddressText(value) {
  if (typeof value !== 'string') return value;
  let afterComma = false;
  return splitTokens(value)
    .map((word, index) => {
      const out = normalizeAddressWord(word, index, afterComma);
      afterComma = /,$/.test(word);
      return out;
    })
    .join(' ');
}

/** Region: "tx" → "TX", "british columbia" → "British Columbia". */
export function normalizeRegion(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (/^[A-Za-z]{2}\.?$/.test(trimmed)) return trimmed.replace(/\./, '').toUpperCase();
  return normalizeAddressText(trimmed);
}

/** Postal code: "k1a  0b1" → "K1A 0B1". */
export function normalizePostalCode(value) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

const ADDRESS_FIELD_NORMALIZERS = {
  line1: normalizeAddressText,
  line2: normalizeAddressText,
  city: normalizeAddressText,
  region: normalizeRegion,
  postalCode: normalizePostalCode,
  country: (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value)
};

/** Normalize every known field of a postal address object, leaving others alone. */
export function normalizeAddress(address) {
  if (!address || typeof address !== 'object') return address;
  const out = { ...address };
  for (const [field, normalize] of Object.entries(ADDRESS_FIELD_NORMALIZERS)) {
    if (typeof out[field] === 'string') out[field] = normalize(out[field]);
  }
  return out;
}
