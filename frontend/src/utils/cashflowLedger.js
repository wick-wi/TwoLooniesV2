/**
 * Period balances for cash-flow: statement anchors + full transaction ledger (includes transfers).
 * Investment accounts: prefer balance_kind cash_only only (not NAV).
 */

export function compareIsoDate(a, b) {
  if (!a || !b) return 0;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

/**
 * Balance row kinds to use for "cash" opening/closing per Plaid-style account_type.
 */
export function preferredBalanceKinds(accountType) {
  const t = (accountType || '').toLowerCase();
  if (t === 'investment') return ['cash_only'];
  return ['statement'];
}

/**
 * Latest balance snapshot strictly before startDate.
 */
export function pickAnchorBalance(balanceRows, accountId, startDate, kinds) {
  const rid = String(accountId);
  const kindSet = new Set(kinds.map((k) => String(k).toLowerCase()));
  const cand = (balanceRows || []).filter((r) => {
    if (!r || String(r.account_id) !== rid || !r.date || r.date >= startDate) return false;
    const bk = (r.balance_kind || 'statement').toString().toLowerCase();
    return kindSet.has(bk);
  });
  if (cand.length === 0) return null;
  cand.sort((a, b) => {
    const c = compareIsoDate(b.date, a.date);
    if (c !== 0) return c;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
  return cand[0];
}

/** Sum signed tx amounts for account with date in (afterExclusive, beforeExclusive). */
export function sumTxBetween(transactions, accountId, afterExclusive, beforeExclusive, conv) {
  const aid = String(accountId);
  let s = 0;
  for (const tx of transactions || []) {
    if (String(tx.account_id) !== aid) continue;
    const d = tx.date;
    if (!d) continue;
    if (afterExclusive && compareIsoDate(d, afterExclusive) <= 0) continue;
    if (beforeExclusive && compareIsoDate(d, beforeExclusive) >= 0) continue;
    s += conv(Number(tx.amount) || 0, (tx.currency || 'CAD').toString().trim() || 'CAD');
  }
  return round2(s);
}

/** Sum signed tx amounts for account with startDate <= date <= endDate (full ledger). */
export function sumTxInRangeInclusive(transactions, accountId, startDate, endDate, conv) {
  const aid = String(accountId);
  let s = 0;
  for (const tx of transactions || []) {
    if (String(tx.account_id) !== aid) continue;
    const d = tx.date;
    if (!d) continue;
    if (compareIsoDate(d, startDate) < 0 || compareIsoDate(d, endDate) > 0) continue;
    s += conv(Number(tx.amount) || 0, (tx.currency || 'CAD').toString().trim() || 'CAD');
  }
  return round2(s);
}

/**
 * Balance entering the selected period (before startDate), display currency.
 */
export function openingBeforeRange({ account, balanceRows, allTransactions, startDate, conv }) {
  const kinds = preferredBalanceKinds(account.account_type);
  const anchor = pickAnchorBalance(balanceRows, account.id, startDate, kinds);
  if (!anchor) return { known: false, amount: 0 };
  const anchorAmt = conv(Number(anchor.amount) || 0, (anchor.currency || 'CAD').toString().trim() || 'CAD');
  const bridge = sumTxBetween(allTransactions, account.id, anchor.date, startDate, conv);
  return { known: true, amount: round2(anchorAmt + bridge) };
}

export function closingAfterRange({ openingKnown, openingAmount, accountId, allTransactions, startDate, endDate, conv }) {
  if (!openingKnown) return { known: false, amount: 0 };
  const delta = sumTxInRangeInclusive(allTransactions, accountId, startDate, endDate, conv);
  return { known: true, amount: round2(openingAmount + delta) };
}

const CASHFLOW_TYPES = ['depository', 'investment'];

export function isCashBalanceAccount(account) {
  return CASHFLOW_TYPES.includes((account.account_type || '').toLowerCase());
}

/**
 * Split period liquidity use into (1) draw from non-negative balances and (2) deepening of
 * negative balances (overdraft / margin). Paydown of negative balances yields zeros here.
 */
export function splitLiquidityDraw(opening, closing) {
  const o = Number(opening) || 0;
  const c = Number(closing) || 0;
  const posO = Math.max(0, o);
  const posC = Math.max(0, c);
  const negO = Math.min(0, o);
  const negC = Math.min(0, c);
  const cashFromPositive = Math.max(0, posO - posC);
  const negativeDeepening = Math.max(0, Math.abs(negC) - Math.abs(negO));
  return {
    cashFromPositive: round2(cashFromPositive),
    negativeDeepening: round2(negativeDeepening),
  };
}

/**
 * Aggregate opening/closing for cash-like accounts (depository + investment cash_only).
 */
export function aggregateCashPeriodBounds({
  accounts,
  accountIds,
  balanceRows,
  allTransactions,
  startDate,
  endDate,
  conv,
}) {
  const idSet = new Set((accountIds || []).map(String));
  let openingSum = 0;
  let closingSum = 0;
  let cashFromPositiveBalances = 0;
  let overdraftDraw = 0;
  let marginDraw = 0;
  let allKnown = true;
  let anyIncluded = false;

  for (const account of accounts || []) {
    const aid = String(account.id);
    if (idSet.size > 0 && !idSet.has(aid)) continue;
    if (!isCashBalanceAccount(account)) continue;
    anyIncluded = true;
    const o = openingBeforeRange({ account, balanceRows, allTransactions, startDate, conv });
    if (!o.known) {
      allKnown = false;
      continue;
    }
    const c = closingAfterRange({
      openingKnown: true,
      openingAmount: o.amount,
      accountId: aid,
      allTransactions,
      startDate,
      endDate,
      conv,
    });
    openingSum += o.amount;
    if (c.known) closingSum += c.amount;
    else allKnown = false;
    if (!c.known) continue;

    const split = splitLiquidityDraw(o.amount, c.amount);
    cashFromPositiveBalances += split.cashFromPositive;
    const acctType = (account.account_type || '').toLowerCase();
    if (acctType === 'investment') marginDraw += split.negativeDeepening;
    else overdraftDraw += split.negativeDeepening;
  }

  return {
    openingSum: round2(openingSum),
    closingSum: round2(closingSum),
    cashFromPositiveBalances: round2(cashFromPositiveBalances),
    overdraftDraw: round2(overdraftDraw),
    marginDraw: round2(marginDraw),
    allKnown,
    anyIncluded,
  };
}

/**
 * For UI copy: which in-scope accounts contribute to aggregateCashPeriodBounds vs which
 * are omitted (no anchor before startDate) vs credit/loan (not in cash estimate).
 */
export function partitionCashEstimateAccounts({
  accounts,
  accountIds,
  balanceRows,
  allTransactions,
  startDate,
  conv,
}) {
  const idSet = new Set((accountIds || []).map(String));
  const included = [];
  const missingAnchor = [];
  const notApplicableType = [];

  for (const account of accounts || []) {
    const aid = String(account.id);
    if (idSet.size > 0 && !idSet.has(aid)) continue;

    const name = account.name || account.official_name || `Account ${aid}`;

    if (!isCashBalanceAccount(account)) {
      notApplicableType.push({ id: aid, name });
      continue;
    }

    const o = openingBeforeRange({ account, balanceRows, allTransactions, startDate, conv });
    if (!o.known) missingAnchor.push({ id: aid, name });
    else included.push({ id: aid, name });
  }

  return { included, missingAnchor, notApplicableType };
}
