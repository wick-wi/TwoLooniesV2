/**
 * FX helpers: rates are "to CAD" (1 unit of foreign = to_cad[code] CAD).
 * Any pair A→B: amount * to_cad[A] / to_cad[B].
 */

const FALLBACK_TO_CAD = { CAD: 1 };

export function normalizeCurrencyCode(code) {
  if (!code || typeof code !== 'string') return 'CAD';
  const u = code.trim().toUpperCase();
  return u || 'CAD';
}

/**
 * @param {Record<string, number>} toCad
 * @param {string} code
 * @returns {number}
 */
export function cadPerUnit(toCad, code) {
  const c = normalizeCurrencyCode(code);
  const m = toCad && typeof toCad === 'object' ? toCad : FALLBACK_TO_CAD;
  const v = m[c];
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (c === 'CAD') return 1;
  return 1;
}

/**
 * @param {number} amount — signed ok
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @param {Record<string, number>} toCad
 */
export function convertViaCad(amount, fromCurrency, toCurrency, toCad) {
  const a = Number(amount);
  if (!Number.isFinite(a)) return 0;
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  if (from === to) return a;
  const f = cadPerUnit(toCad, from);
  const t = cadPerUnit(toCad, to);
  return (a * f) / t;
}

export function sortedCurrencyCodes(toCad) {
  const m = toCad && typeof toCad === 'object' ? toCad : FALLBACK_TO_CAD;
  return Object.keys(m)
    .filter((k) => typeof m[k] === 'number' && m[k] > 0)
    .sort();
}
