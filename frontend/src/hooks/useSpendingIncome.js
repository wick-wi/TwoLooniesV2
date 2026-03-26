import { useMemo } from 'react';
import { convertViaCad } from '../utils/fx';

/**
 * Categories that represent internal movement or wealth conversion —
 * strictly excluded from the Spending & Income view.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Self-Transfer',
  'Credit Card Payment',
  'Securities Trading',
  'E-Transfer',
  'Loans & Reimbursements',
  'Reimbursements & Loans',
]);

/**
 * The canonical "Income" categories. Positive amounts in these categories
 * count as income. Positive amounts in ALL OTHER categories are treated as
 * refunds/reversals and reduce spending instead.
 */
const INCOME_CATEGORIES = new Set(['Income']);

/**
 * Classify a single transaction after exclusion filters have passed.
 *
 * Returns one of:
 *   'income'  — external inflow (payroll, interest, etc.)
 *   'refund'  — positive amount in a spending category; reduces spending
 *   'spending' — negative amount (outflow)
 *   null      — zero-amount, skip
 */
function classifyTransaction(tx) {
  const amount = Number(tx.amount) || 0;
  if (amount === 0) return null;

  const cat = (tx.category || '').trim();

  if (amount > 0) {
    // Positive amount in an Income category → real income
    if (INCOME_CATEGORIES.has(cat)) return 'income';
    // Positive amount elsewhere (or with refund keyword) → spending reversal
    return 'refund';
  }

  // amount < 0 → outflow
  return 'spending';
}

/**
 * Build the 6-month lookback window based on the most recent full calendar
 * month available in the dataset (or today if no transactions).
 * Returns an array of 'YYYY-MM' strings, oldest-first.
 */
function buildSixMonthWindow(transactions) {
  const today = new Date();
  let referenceYear = today.getFullYear();
  let referenceMonth = today.getMonth() + 1; // 1-indexed

  // Find the latest transaction month in the dataset
  for (const tx of transactions) {
    if (!tx.date || tx.date.length < 7) continue;
    const [y, m] = tx.date.slice(0, 7).split('-').map(Number);
    const txVal = y * 12 + m;
    const refVal = referenceYear * 12 + referenceMonth;
    if (txVal > refVal) {
      referenceYear = y;
      referenceMonth = m;
    }
  }

  const months = [];
  for (let i = 5; i >= 0; i--) {
    let m = referenceMonth - i;
    let y = referenceYear;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'short' });
}

/**
 * useSpendingIncome
 *
 * Strict burn-rate filter hook. Accepts all transactions from the analysis
 * context plus the active date window and FX rates, and returns aggregated
 * data for KPI cards, 6-month bar chart, spending donut, and ledger table.
 *
 * Filtering rules (in order):
 *  1. EXCLUDE is_transfer === true
 *  2. EXCLUDE linked_transaction_id set AND that partner is in the visible set
 *     (paired credit-card payments, paired reimbursements, etc.)
 *  3. EXCLUDE category in EXCLUDED_CATEGORIES
 *  4. Apply refund rule: positive amount in non-Income category → reduces
 *     spending (not counted as income)
 *
 * @param {object} params
 * @param {Array}  params.transactions   - All transactions from useAnalysis()
 * @param {string} params.startDate      - 'YYYY-MM-DD' inclusive start, or ''
 * @param {string} params.endDate        - 'YYYY-MM-DD' inclusive end, or ''
 * @param {object} params.toCadMap       - FX rates map from /api/exchange_rates
 * @param {string} params.displayCurrency - ISO code for display (default 'CAD')
 */
export function useSpendingIncome({
  transactions,
  startDate,
  endDate,
  toCadMap,
  displayCurrency = 'CAD',
}) {
  return useMemo(() => {
    const allTxns = transactions || [];
    const targetCcy = displayCurrency || 'CAD';
    const fxMap = toCadMap && typeof toCadMap === 'object' ? toCadMap : { CAD: 1 };

    const conv = (amount, currency) =>
      convertViaCad(amount, currency || 'CAD', targetCcy, fxMap);

    // --- Step 1: Build the visible-id set for linked-pair detection ----------
    // Only look at transactions in date range for pair detection
    const rangeFiltered = allTxns.filter((tx) => {
      if (!startDate || !endDate) return true;
      const d = tx.date;
      return d && d >= startDate && d <= endDate;
    });

    const visibleIds = new Set(
      rangeFiltered.map((tx) => (tx.id != null ? String(tx.id) : null)).filter(Boolean)
    );

    // --- Step 2: Apply exclusion filters -------------------------------------
    const clean = rangeFiltered.filter((tx) => {
      // Exclude hard-flagged transfers
      if (tx.is_transfer === true) return false;

      // Exclude one leg when both legs of a linked pair are in view
      const lid = tx.linked_transaction_id;
      if (lid != null && lid !== '' && visibleIds.has(String(lid))) return false;

      // Exclude internal / wealth-conversion categories
      const cat = (tx.category || '').trim();
      if (EXCLUDED_CATEGORIES.has(cat)) return false;

      return true;
    });

    // --- Step 3: Classify and aggregate KPIs ---------------------------------
    let totalIncome = 0;
    let totalSpending = 0;
    const spendingByCategory = {}; // { category: positiveAmount }
    const spendingByCategoryNet = {}; // tracks net per-category (refunds reduce)

    for (const tx of clean) {
      const raw = Number(tx.amount) || 0;
      if (raw === 0) continue;
      const converted = conv(raw, tx.currency || 'CAD');
      const cat = (tx.category || 'Uncategorized').trim();
      const classification = classifyTransaction(tx);

      if (classification === 'income') {
        totalIncome += converted;
      } else if (classification === 'spending') {
        // negative amount → outflow magnitude
        const magnitude = Math.abs(converted);
        totalSpending += magnitude;
        spendingByCategoryNet[cat] = (spendingByCategoryNet[cat] || 0) + magnitude;
      } else if (classification === 'refund') {
        // positive amount in non-Income category → spending reduction
        totalSpending = Math.max(0, totalSpending - converted);
        spendingByCategoryNet[cat] = (spendingByCategoryNet[cat] || 0) - converted;
      }
    }

    // Build spending-by-category array (only positive net values for donut)
    for (const [cat, net] of Object.entries(spendingByCategoryNet)) {
      if (net > 0.005) {
        spendingByCategory[cat] = Math.round(net * 100) / 100;
      }
    }

    const savings = totalIncome - totalSpending;

    // --- Step 4: Build 6-month trend data for bar chart ----------------------
    const sixMonths = buildSixMonthWindow(allTxns);

    // Aggregate over all (undate-filtered) clean transactions for the trend
    // window. We rebuild clean list over full history just for the bar chart.
    const allVisibleIds = new Set(
      allTxns.map((tx) => (tx.id != null ? String(tx.id) : null)).filter(Boolean)
    );

    const allClean = allTxns.filter((tx) => {
      if (tx.is_transfer === true) return false;
      const lid = tx.linked_transaction_id;
      if (lid != null && lid !== '' && allVisibleIds.has(String(lid))) return false;
      const cat = (tx.category || '').trim();
      if (EXCLUDED_CATEGORIES.has(cat)) return false;
      return true;
    });

    const monthlyBuckets = {};
    for (const ym of sixMonths) {
      monthlyBuckets[ym] = { income: 0, spending: 0, refunds: 0 };
    }

    for (const tx of allClean) {
      if (!tx.date || tx.date.length < 7) continue;
      const ym = tx.date.slice(0, 7);
      if (!monthlyBuckets[ym]) continue;

      const raw = Number(tx.amount) || 0;
      if (raw === 0) continue;
      const converted = conv(raw, tx.currency || 'CAD');
      const classification = classifyTransaction(tx);

      if (classification === 'income') {
        monthlyBuckets[ym].income += converted;
      } else if (classification === 'spending') {
        monthlyBuckets[ym].spending += Math.abs(converted);
      } else if (classification === 'refund') {
        monthlyBuckets[ym].refunds += converted;
      }
    }

    const monthlyData = sixMonths.map((ym) => {
      const b = monthlyBuckets[ym];
      const netSpending = Math.max(0, b.spending - b.refunds);
      const net = b.income - netSpending;
      return {
        month: monthLabel(ym),
        ym,
        income: Math.round(b.income * 100) / 100,
        spending: Math.round(netSpending * 100) / 100,
        net: Math.round(net * 100) / 100,
      };
    });

    // --- Step 5: Ledger table (date-filtered clean, sorted newest-first) -----
    const filteredTransactions = [...clean].sort((a, b) => {
      if (a.date > b.date) return -1;
      if (a.date < b.date) return 1;
      return 0;
    });

    return {
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalSpending: Math.round(totalSpending * 100) / 100,
      savings: Math.round(savings * 100) / 100,
      monthlyData,
      spendingByCategory,
      filteredTransactions,
    };
  }, [transactions, startDate, endDate, toCadMap, displayCurrency]);
}
