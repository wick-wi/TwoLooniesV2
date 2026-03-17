export function formatMoney(
  value,
  currency,
  {
    locale = 'en-CA',
    minimumFractionDigits = 0,
    maximumFractionDigits,
  } = {}
) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;

  if (!currency) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits,
      ...(maximumFractionDigits != null ? { maximumFractionDigits } : {}),
    }).format(safe);
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits,
      ...(maximumFractionDigits != null ? { maximumFractionDigits } : {}),
    }).format(safe);
  } catch {
    return String(safe);
  }
}

