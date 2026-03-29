import { useMemo } from 'react';
import { convertViaCad } from '../utils/fx';

/**
 * Account subtype → wealth-type mapping (mirrors WealthTab.js).
 * Used to categorise balances for net worth and runway calculations.
 */
const WEALTH_TYPE_BY_ACCOUNT = {
  auto_loan: 'Liability', AutoLoan: 'Liability',
  chequing: 'Liquid Cash', Chequing: 'Liquid Cash',
  credit_card: 'Liability', 'Credit Card': 'Liability',
  crypto: 'Liquid Asset', Crypto: 'Liquid Asset',
  dpsp: 'Retirement Locked', DPSP: 'Retirement Locked',
  esop: 'Liquid Asset', ESOP: 'Liquid Asset',
  fhsa: 'Purpose Locked', FHSA: 'Purpose Locked',
  gic: 'Time Locked', GIC: 'Time Locked',
  heloc: 'Liability', HELOC: 'Liability',
  line_of_credit: 'Liability', 'Line of Credit': 'Liability',
  lira: 'Retirement Locked', LIRA: 'Retirement Locked',
  margin: 'Liquid Asset', Margin: 'Liquid Asset',
  mortgage: 'Liability', Mortgage: 'Liability',
  rdsp: 'Purpose Locked', RDSP: 'Purpose Locked',
  resp: 'Purpose Locked', RESP: 'Purpose Locked',
  rpp: 'Retirement Locked', RPP: 'Retirement Locked',
  rrif: 'Retirement Locked', RRIF: 'Retirement Locked',
  rrsp: 'Retirement Locked', RRSP: 'Retirement Locked',
  savings: 'Liquid Cash', Savings: 'Liquid Cash',
  student_loan: 'Liability', 'Student Loan': 'Liability',
  tfsa: 'Liquid Asset', TFSA: 'Liquid Asset',
};

const EXCLUDED_CATEGORIES = new Set([
  'Self-Transfer',
  'Credit Card Payment',
  'Securities Trading',
  'E-Transfer',
  'Loans & Reimbursements',
  'Reimbursements & Loans',
]);

const INCOME_CATEGORIES = new Set(['Income']);

/**
 * Returns 'YYYY-MM' for a transaction date string, or null.
 */
function toYearMonth(dateStr) {
  if (!dateStr || dateStr.length < 7) return null;
  return dateStr.slice(0, 7);
}

/**
 * Subtract N months from a {year, month} pair (1-indexed month).
 */
function subtractMonths(year, month, n) {
  let m = month - n;
  let y = year;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return { year: y, month: m };
}

function ymString(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Build clean expense-only transactions from all transactions (mirrors useSpendingIncome
 * filtering but just accumulates monthly spending totals and per-category totals).
 */
function buildMonthlySpending(transactions, toCadMap) {
  const allIds = new Set(
    transactions.map((tx) => (tx.id != null ? String(tx.id) : null)).filter(Boolean)
  );

  const monthlyTotal = {};   // { 'YYYY-MM': number }
  const monthlyByCategory = {}; // { 'YYYY-MM': { category: number } }

  for (const tx of transactions) {
    if (tx.is_transfer === true) continue;
    const lid = tx.linked_transaction_id;
    if (lid != null && lid !== '' && allIds.has(String(lid))) continue;
    const cat = (tx.category || '').trim();
    if (EXCLUDED_CATEGORIES.has(cat)) continue;

    const amount = Number(tx.amount) || 0;
    if (amount === 0) continue;

    const ym = toYearMonth(tx.date);
    if (!ym) continue;

    // Only count spending (outflows) for inflation/runway
    if (amount < 0) {
      const magnitude = Math.abs(convertViaCad(amount, tx.currency || 'CAD', 'CAD', toCadMap));
      monthlyTotal[ym] = (monthlyTotal[ym] || 0) + magnitude;
      if (!monthlyByCategory[ym]) monthlyByCategory[ym] = {};
      monthlyByCategory[ym][cat] = (monthlyByCategory[ym][cat] || 0) + magnitude;
    } else if (!INCOME_CATEGORIES.has(cat)) {
      // Refund: reduce spending
      const magnitude = convertViaCad(amount, tx.currency || 'CAD', 'CAD', toCadMap);
      monthlyTotal[ym] = Math.max(0, (monthlyTotal[ym] || 0) - magnitude);
      if (!monthlyByCategory[ym]) monthlyByCategory[ym] = {};
      monthlyByCategory[ym][cat] = Math.max(0, (monthlyByCategory[ym][cat] || 0) - magnitude);
    }
  }

  return { monthlyTotal, monthlyByCategory };
}

/**
 * useDashboardMetrics
 *
 * Computes the three hero metrics for the Dashboard tab from raw API data:
 *   - netWorth: total assets minus liabilities in CAD
 *   - runwayMonths: liquid cash / avg monthly spending (last 3 complete months)
 *   - avgMonthlySpend: the average used for runway
 *   - inflation: { value, period, trend, highestCategory }
 *
 * @param {object} params
 * @param {Array}  params.accounts      - from /api/accounts_with_balances
 * @param {Array}  params.transactions  - from /api/user_data
 * @param {object} params.toCadMap      - { CAD: 1, USD: 1.36, ... } from /api/exchange_rates
 */
export function useDashboardMetrics({ accounts = [], transactions = [], toCadMap = { CAD: 1 } }) {
  return useMemo(() => {
    // ── Net Worth ─────────────────────────────────────────────────────────────
    let totalAssets = 0;
    let totalLiabilities = 0;
    let liquidCash = 0;

    for (const account of accounts) {
      const subtype = account.account_subtype || account.account_type;
      const wealthType = WEALTH_TYPE_BY_ACCOUNT[subtype] || 'Liquid Asset';
      const balances = Array.isArray(account.balances) && account.balances.length > 0
        ? account.balances
        : [{ amount: 0, currency: 'CAD' }];

      for (const b of balances) {
        const cadValue = convertViaCad(Number(b.amount ?? 0), b.currency || 'CAD', 'CAD', toCadMap);
        if (wealthType === 'Liability') {
          totalLiabilities += Math.abs(cadValue);
        } else {
          totalAssets += cadValue;
          if (wealthType === 'Liquid Cash') {
            liquidCash += cadValue;
          }
        }
      }
    }

    const netWorth = totalAssets - totalLiabilities;

    // ── Personal Runway ───────────────────────────────────────────────────────
    // Use average spending across last 3 complete months
    const today = new Date();
    const currentYm = ymString(today.getFullYear(), today.getMonth() + 1);

    const { monthlyTotal, monthlyByCategory } = buildMonthlySpending(transactions, toCadMap);

    // Collect complete months (exclude current in-progress month)
    const completedMonths = Object.keys(monthlyTotal)
      .filter((ym) => ym < currentYm)
      .sort()
      .reverse();

    const last3 = completedMonths.slice(0, 3);
    const avgMonthlySpend = last3.length > 0
      ? last3.reduce((sum, ym) => sum + (monthlyTotal[ym] || 0), 0) / last3.length
      : 0;

    const runwayMonths = avgMonthlySpend > 0
      ? Math.round((liquidCash / avgMonthlySpend) * 10) / 10
      : null;

    // ── Personal Inflation ────────────────────────────────────────────────────
    // Prefer YoY: compare most recent complete month vs same month last year.
    // Fall back to MoM if not enough history.
    const mostRecentComplete = completedMonths[0] ?? null;
    let inflation = null;

    if (mostRecentComplete) {
      const [refYear, refMonth] = mostRecentComplete.split('-').map(Number);
      const recentSpend = monthlyTotal[mostRecentComplete] || 0;

      // Try YoY first
      const yoyYm = ymString(refYear - 1, refMonth);
      const yoySpend = monthlyTotal[yoyYm];

      if (yoySpend != null && yoySpend > 0) {
        const pct = ((recentSpend - yoySpend) / yoySpend) * 100;

        // Per-category YoY change for most recent month
        const recentCats = monthlyByCategory[mostRecentComplete] || {};
        const yoyCats = monthlyByCategory[yoyYm] || {};
        let highestCategory = null;
        let highestChange = -Infinity;

        for (const [cat, spend] of Object.entries(recentCats)) {
          const prior = yoyCats[cat] || 0;
          if (prior > 10) { // only compare categories with meaningful prior spend
            const catPct = ((spend - prior) / prior) * 100;
            if (catPct > highestChange) {
              highestChange = catPct;
              highestCategory = { name: cat, change: Math.round(catPct * 10) / 10 };
            }
          }
        }

        inflation = {
          value: Math.round(pct * 10) / 10,
          period: 'YoY',
          trend: pct >= 0 ? 'up' : 'down',
          highestCategory,
        };
      } else {
        // Fall back to MoM
        const { year: priorYear, month: priorMonth } = subtractMonths(refYear, refMonth, 1);
        const momYm = ymString(priorYear, priorMonth);
        const momSpend = monthlyTotal[momYm];

        if (momSpend != null && momSpend > 0) {
          const pct = ((recentSpend - momSpend) / momSpend) * 100;

          const recentCats = monthlyByCategory[mostRecentComplete] || {};
          const momCats = monthlyByCategory[momYm] || {};
          let highestCategory = null;
          let highestChange = -Infinity;

          for (const [cat, spend] of Object.entries(recentCats)) {
            const prior = momCats[cat] || 0;
            if (prior > 10) {
              const catPct = ((spend - prior) / prior) * 100;
              if (catPct > highestChange) {
                highestChange = catPct;
                highestCategory = { name: cat, change: Math.round(catPct * 10) / 10 };
              }
            }
          }

          inflation = {
            value: Math.round(pct * 10) / 10,
            period: 'MoM',
            trend: pct >= 0 ? 'up' : 'down',
            highestCategory,
          };
        }
      }
    }

    return {
      netWorth,
      liquidCash,
      runwayMonths,
      avgMonthlySpend,
      inflation,
      hasData: accounts.length > 0 || transactions.length > 0,
    };
  }, [accounts, transactions, toCadMap]);
}
