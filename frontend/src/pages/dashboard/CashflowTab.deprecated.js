import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Wallet, Briefcase, ArrowLeftRight, CircleHelp, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAnalysis } from '../../context/AnalysisContext';
import CashflowSankey from '../../components/CashflowSankey';
import { formatMoney } from '../../utils/money';
import { convertViaCad, sortedCurrencyCodes } from '../../utils/fx';
import { aggregateCashPeriodBounds, partitionCashEstimateAccounts } from '../../utils/cashflowLedger';
import './CashflowTab.deprecated.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

const DISPLAY_CCY_LS = 'tl_cashflow_display_ccy';

function CashflowFootnoteRef({ footnotes, fnKey }) {
  const entry = footnotes.find((f) => f.key === fnKey);
  if (!entry) return null;
  return (
    <sup className="cashflow-tab-fn-ref">
      <a href={`#cashflow-fn-${fnKey}`} title={`Note ${entry.num}`}>
        {entry.num}
      </a>
    </sup>
  );
}

/** Plaid-style top-level types; subtype (e.g. TFSA) lives on account_subtype. */
const CASHFLOW_ACCOUNT_TYPES = ['depository', 'credit', 'loan', 'investment'];

// Paired card/loan flows: omitted when both legs are in view; Self-Transfer / E-Transfer are bucketed instead.
const CASHFLOW_EXCLUDE_CATEGORIES = [
  'Credit Card Payment',
  'Reimbursements & Loans',
  'Loans & Reimbursements',
];

/**
 * Sankey: still hide reimbursement/loan buckets when both legs of a linked pair are in view.
 * Orphan legs (partner outside filter) stay visible. Paired rows are dropped via linked_transaction_id.
 */
const SANKEY_EXCLUDE_CATEGORIES = ['Credit Card Payment', 'Reimbursements & Loans', 'Loans & Reimbursements'];

const SECURITIES_TRADING_CATEGORY = 'Securities Trading';
const UNCATEGORIZED_CATEGORY = 'Uncategorized';
const SELF_TRANSFER_CATEGORY = 'Self-Transfer';
const ETRANSFER_CATEGORY = 'E-Transfer';

function linkedPartnerInView(tx, visibleTxnIds) {
  const lid = tx.linked_transaction_id;
  return lid != null && lid !== '' && visibleTxnIds.has(String(lid));
}

/** True when this row is omitted from cash-flow buckets (paired reimbursements / CC payment rules). */
function excludedByCategoryRules(tx, visibleTxnIds, categoryList) {
  const cat = tx.category;
  if (!cat || !categoryList.includes(cat)) return false;
  const lid = tx.linked_transaction_id;
  const hasLink = lid != null && lid !== '';
  if (hasLink && !visibleTxnIds.has(String(lid))) return false;
  return true;
}

function excludeFromCashflowTotals(tx, visibleTxnIds, categoryList) {
  if (linkedPartnerInView(tx, visibleTxnIds)) return true;
  return excludedByCategoryRules(tx, visibleTxnIds, categoryList);
}

function getLatestCalendarMonthFromTransactions(transactions) {
  if (!transactions || transactions.length === 0) return null;
  let maxDate = null;
  for (const tx of transactions) {
    const d = tx.date;
    if (!d) continue;
    if (!maxDate || d > maxDate) maxDate = d;
  }
  if (!maxDate) return null;
  const [y, m] = maxDate.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    startDate: `${y}-${String(m).padStart(2, '0')}-01`,
    endDate: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function transactionMonthKey(dateStr) {
  if (!dateStr || dateStr.length < 7) return null;
  return dateStr.slice(0, 7);
}

function calendarRangeForMonthKey(ym) {
  if (!ym || ym.length !== 7) return null;
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return null;
  const lastDay = new Date(y, m, 0).getDate();
  return {
    startDate: `${y}-${String(m).padStart(2, '0')}-01`,
    endDate: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Latest month (scanning newest-first) where a strict majority of accounts that
 * appear in `transactions` have ≥1 transaction in that month; otherwise the month
 * of the latest transaction in the list.
 */
function computeConsensusMonthRange(transactions) {
  const list = transactions || [];
  if (list.length === 0) return null;
  const accountIds = [
    ...new Set(
      list
        .map((tx) => (tx.account_id != null ? String(tx.account_id) : null))
        .filter(Boolean)
    ),
  ];
  const n = accountIds.length;
  if (n === 0) return null;

  const monthToAccountSet = new Map();
  for (const tx of list) {
    const mk = transactionMonthKey(tx.date);
    const aid = tx.account_id != null ? String(tx.account_id) : null;
    if (!mk || !aid) continue;
    if (!monthToAccountSet.has(mk)) monthToAccountSet.set(mk, new Set());
    monthToAccountSet.get(mk).add(aid);
  }
  if (monthToAccountSet.size === 0) return getLatestCalendarMonthFromTransactions(list);

  const monthsSorted = [...monthToAccountSet.keys()].sort().reverse();
  for (const ym of monthsSorted) {
    const inMonth = monthToAccountSet.get(ym);
    if (inMonth.size * 2 > n) return calendarRangeForMonthKey(ym);
  }
  return getLatestCalendarMonthFromTransactions(list);
}

function cashflowDatePrefsStorageKey(userId) {
  return userId ? `tl_cashflow_dates_${userId}` : null;
}

export default function CashflowTab() {
  const { getAccessToken, user } = useAuth();
  const { transactions, accounts, balances, setAnalysisData } = useAnalysis();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [datesPinned, setDatesPinned] = useState(false);
  const [datePrefsHydrated, setDatePrefsHydrated] = useState(false);
  const [fxPayload, setFxPayload] = useState(null);
  const [displayCurrency, setDisplayCurrency] = useState('CAD');

  const token = getAccessToken?.();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/exchange_rates`);
        if (cancelled) return;
        const data = res.data || {};
        const toCad = data.to_cad && typeof data.to_cad === 'object' ? data.to_cad : { CAD: 1 };
        setFxPayload({
          base: data.base || 'CAD',
          as_of: data.as_of || '',
          to_cad: toCad,
        });
        const codes = sortedCurrencyCodes(toCad);
        let sel = 'CAD';
        try {
          const raw = localStorage.getItem(DISPLAY_CCY_LS);
          if (raw && codes.includes(raw)) sel = raw;
        } catch {
          /* ignore */
        }
        if (!codes.includes(sel)) sel = 'CAD';
        setDisplayCurrency(sel);
      } catch {
        if (!cancelled) {
          setFxPayload({ base: 'CAD', as_of: '', to_cad: { CAD: 1 } });
          setDisplayCurrency('CAD');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchUserData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/user_data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAnalysisData(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [token, setAnalysisData]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    if ((!transactions || transactions.length === 0) && (!accounts || accounts.length === 0)) {
      fetchUserData();
    } else {
      setLoading(false);
    }
  }, [token, transactions, accounts, fetchUserData]);

  const eligibleAccountIds = useMemo(() => {
    const set = new Set();
    for (const a of accounts || []) {
      if (CASHFLOW_ACCOUNT_TYPES.includes(a.account_type)) {
        const id = a.id != null ? String(a.id) : null;
        if (id) set.add(id);
      }
    }
    return set;
  }, [accounts]);

  const cashflowAccounts = useMemo(() => {
    return (accounts || [])
      .filter((a) => CASHFLOW_ACCOUNT_TYPES.includes(a.account_type))
      .map((a) => {
        const id = a.id != null ? String(a.id) : '';
        const name = a.name || a.official_name || `Account ${id || 'Unknown'}`;
        return { id, name };
      })
      .filter((a) => a.id);
  }, [accounts]);

  const transactionsByCashflowAccounts = useMemo(() => {
    const list = transactions || [];
    return list.filter((tx) => {
      const aid = tx.account_id != null ? String(tx.account_id) : null;
      return aid && eligibleAccountIds.has(aid);
    });
  }, [transactions, eligibleAccountIds]);

  const activeCashflowAccountIds = useMemo(() => {
    if (selectedAccounts.length > 0) return selectedAccounts.map(String);
    return [...eligibleAccountIds];
  }, [selectedAccounts, eligibleAccountIds]);

  const transactionsBySelectedAccounts = useMemo(() => {
    if (!selectedAccounts || selectedAccounts.length === 0) {
      return transactionsByCashflowAccounts;
    }
    const selectedSet = new Set(selectedAccounts);
    return transactionsByCashflowAccounts.filter((tx) => {
      const aid = tx.account_id != null ? String(tx.account_id) : null;
      return aid && selectedSet.has(aid);
    });
  }, [transactionsByCashflowAccounts, selectedAccounts]);

  const autoDateRange = useMemo(
    () => computeConsensusMonthRange(transactionsBySelectedAccounts),
    [transactionsBySelectedAccounts]
  );

  const datePrefsKey = cashflowDatePrefsStorageKey(user?.id);

  useEffect(() => {
    if (!token) {
      setDatePrefsHydrated(true);
      return;
    }
    if (datePrefsKey) {
      try {
        const raw = sessionStorage.getItem(datePrefsKey);
        if (raw) {
          const o = JSON.parse(raw);
          if (o?.pinned && o.startDate && o.endDate) {
            setStartDate(o.startDate);
            setEndDate(o.endDate);
            setDatesPinned(true);
          } else {
            setDatesPinned(false);
            setStartDate('');
            setEndDate('');
          }
        } else {
          setDatesPinned(false);
          setStartDate('');
          setEndDate('');
        }
      } catch {
        setDatesPinned(false);
        setStartDate('');
        setEndDate('');
      }
    }
    setDatePrefsHydrated(true);
  }, [token, datePrefsKey]);

  useEffect(() => {
    if (!datePrefsHydrated || !datePrefsKey) return;
    if (datesPinned && startDate && endDate) {
      try {
        sessionStorage.setItem(
          datePrefsKey,
          JSON.stringify({ pinned: true, startDate, endDate })
        );
      } catch {
        /* ignore */
      }
    } else {
      try {
        sessionStorage.removeItem(datePrefsKey);
      } catch {
        /* ignore */
      }
    }
  }, [datePrefsHydrated, datePrefsKey, datesPinned, startDate, endDate]);

  useEffect(() => {
    if (!datePrefsHydrated || datesPinned) return;
    if (autoDateRange) {
      setStartDate(autoDateRange.startDate);
      setEndDate(autoDateRange.endDate);
    } else {
      setStartDate('');
      setEndDate('');
    }
  }, [datePrefsHydrated, datesPinned, autoDateRange]);

  const filteredByDate = useMemo(() => {
    const list = transactionsBySelectedAccounts;
    if (!startDate || !endDate) return list;
    return list.filter((tx) => {
      const d = tx.date;
      return d && d >= startDate && d <= endDate;
    });
  }, [transactionsBySelectedAccounts, startDate, endDate]);

  const toCadMap = useMemo(() => {
    const t = fxPayload?.to_cad;
    return t && typeof t === 'object' ? t : { CAD: 1 };
  }, [fxPayload]);
  const fxAsOf = fxPayload?.as_of || '';
  const currencyOptions = useMemo(() => sortedCurrencyCodes(toCadMap), [toCadMap]);

  const handleDisplayCurrencyChange = useCallback((e) => {
    const v = e.target.value;
    setDisplayCurrency(v);
    try {
      localStorage.setItem(DISPLAY_CCY_LS, v);
    } catch {
      /* ignore */
    }
  }, []);

  const {
    cashInflow,
    spending,
    investmentOut,
    transfersOut,
    uncategorizedOut,
    securitiesSalesInflow,
    savings,
    categoryBreakdowns,
    cashBounds,
    sourceSlices,
    sankeySpendingTotal,
    sankeyInvestmentOutTotal,
    sankeyTransfersOutTotal,
    sankeyUncategorizedOutTotal,
    sankeyTransfersOutSelf,
    sankeyTransfersOutEtransfer,
    sankeySavingsFlow,
    sankeySankeyMode,
    sankeySpendingCategoryBreakdowns,
  } = useMemo(() => {
    const list = filteredByDate;
    const visibleTxnIds = new Set(
      list.map((tx) => (tx.id != null ? String(tx.id) : null)).filter(Boolean)
    );

    const excludeFromIncomeExpense = (tx) =>
      excludeFromCashflowTotals(tx, visibleTxnIds, CASHFLOW_EXCLUDE_CATEGORIES);

    const excludeFromSankeyFlow = (tx) =>
      excludeFromCashflowTotals(tx, visibleTxnIds, SANKEY_EXCLUDE_CATEGORIES);

    const targetCcy = displayCurrency || 'CAD';
    const conv = (amt, txCurrency) =>
      convertViaCad(amt, txCurrency || 'CAD', targetCcy, toCadMap);

    let cashBoundsInner = {
      openingSum: 0,
      closingSum: 0,
      cashFromPositiveBalances: 0,
      overdraftDraw: 0,
      marginDraw: 0,
      allKnown: false,
      anyIncluded: false,
    };
    if (startDate && endDate && Array.isArray(balances) && balances.length > 0) {
      cashBoundsInner = aggregateCashPeriodBounds({
        accounts,
        accountIds: activeCashflowAccountIds,
        balanceRows: balances,
        allTransactions: transactions || [],
        startDate,
        endDate,
        conv,
      });
    }

    const emptyBuckets = () => ({
      cashInflow: 0,
      spendingOut: 0,
      investmentOut: 0,
      transfersSelfOut: 0,
      transfersEOut: 0,
      uncategorizedOut: 0,
      securitiesSales: 0,
      uncategorizedIn: 0,
      byCategory: {},
    });

    const addSignedToBuckets = (b, signed, cat) => {
      b.byCategory[cat] = (b.byCategory[cat] || 0) + signed;
      if (signed > 0) {
        b.cashInflow += signed;
        if (cat === SECURITIES_TRADING_CATEGORY) b.securitiesSales += signed;
        if (cat === UNCATEGORIZED_CATEGORY) b.uncategorizedIn += signed;
      } else if (signed < 0) {
        const mag = -signed;
        if (cat === SECURITIES_TRADING_CATEGORY) b.investmentOut += mag;
        else if (cat === SELF_TRANSFER_CATEGORY) b.transfersSelfOut += mag;
        else if (cat === ETRANSFER_CATEGORY) b.transfersEOut += mag;
        else if (cat === UNCATEGORIZED_CATEGORY) b.uncategorizedOut += mag;
        else b.spendingOut += mag;
      }
    };

    const cardB = emptyBuckets();
    const skB = emptyBuckets();

    for (const tx of list) {
      const amount = Number(tx.amount) || 0;
      if (amount === 0) continue;
      const txCur = (tx.currency || 'CAD').toString().trim() || 'CAD';
      const cat = tx.category || UNCATEGORIZED_CATEGORY;
      const signed = conv(amount, txCur);
      if (!excludeFromIncomeExpense(tx)) addSignedToBuckets(cardB, signed, cat);
      if (!excludeFromSankeyFlow(tx)) addSignedToBuckets(skB, signed, cat);
    }

    const categoryBreakdowns = Object.entries(cardB.byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    const cashInflowR = Math.round(cardB.cashInflow * 100) / 100;
    const spendingR = Math.round(cardB.spendingOut * 100) / 100;
    const investmentOutR = Math.round(cardB.investmentOut * 100) / 100;
    const transfersOutR =
      Math.round((cardB.transfersSelfOut + cardB.transfersEOut) * 100) / 100;
    const uncategorizedOutR = Math.round(cardB.uncategorizedOut * 100) / 100;
    const securitiesSalesR = Math.round(cardB.securitiesSales * 100) / 100;
    const net =
      Math.round(
        (cardB.cashInflow -
          cardB.spendingOut -
          cardB.investmentOut -
          cardB.transfersSelfOut -
          cardB.transfersEOut -
          cardB.uncategorizedOut) *
          100
      ) / 100;

    const skSpendingCategoryBreakdowns = Object.entries(skB.byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .filter(
        (c) =>
          c.amount < 0 &&
          c.category !== SECURITIES_TRADING_CATEGORY &&
          c.category !== SELF_TRANSFER_CATEGORY &&
          c.category !== ETRANSFER_CATEGORY &&
          c.category !== UNCATEGORIZED_CATEGORY
      )
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const skSpendingR = Math.round(skB.spendingOut * 100) / 100;
    const skInvestmentOutR = Math.round(skB.investmentOut * 100) / 100;
    const skTransfersOutR =
      Math.round((skB.transfersSelfOut + skB.transfersEOut) * 100) / 100;
    const skUncategorizedOutR = Math.round(skB.uncategorizedOut * 100) / 100;
    const skSelfR = Math.round(skB.transfersSelfOut * 100) / 100;
    const skEtrfR = Math.round(skB.transfersEOut * 100) / 100;
    const skInvestmentInR = Math.round(skB.securitiesSales * 100) / 100;
    const skNet =
      Math.round(
        (skB.cashInflow -
          skB.spendingOut -
          skB.investmentOut -
          skB.transfersSelfOut -
          skB.transfersEOut -
          skB.uncategorizedOut) *
          100
      ) / 100;
    const skSavingsFlow = skNet > 0 ? skNet : 0;
    const skSankeyMode = skNet >= 0 ? 'surplus' : 'deficit';
    const needMid =
      skSpendingR +
      skInvestmentOutR +
      skTransfersOutR +
      skUncategorizedOutR +
      (skSankeyMode === 'surplus' ? skSavingsFlow : 0);

    let cashFromPositive = 0;
    let overdraftDraw = 0;
    let marginDraw = 0;
    if (cashBoundsInner.allKnown && cashBoundsInner.anyIncluded) {
      cashFromPositive = Math.round((cashBoundsInner.cashFromPositiveBalances || 0) * 100) / 100;
      overdraftDraw = Math.round((cashBoundsInner.overdraftDraw || 0) * 100) / 100;
      marginDraw = Math.round((cashBoundsInner.marginDraw || 0) * 100) / 100;
    }

    const MAX_INFLOW = 6;
    const catMap = {};
    for (const tx of list) {
      if (excludeFromSankeyFlow(tx)) continue;
      const amount = Number(tx.amount) || 0;
      if (amount <= 0) continue;
      const cat = tx.category || UNCATEGORIZED_CATEGORY;
      if (cat === SECURITIES_TRADING_CATEGORY) continue;
      const txCur = (tx.currency || 'CAD').toString().trim() || 'CAD';
      catMap[cat] = (catMap[cat] || 0) + conv(amount, txCur);
    }
    const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    let catParts = catEntries.slice(0, MAX_INFLOW).map(([label, v]) => ({
      label,
      value: Math.round(v * 100) / 100,
    }));
    const restCat = catEntries.slice(MAX_INFLOW).reduce((s, [, v]) => s + v, 0);
    if (restCat > 0.01) {
      catParts.push({ label: 'Other inflow', value: Math.round(restCat * 100) / 100 });
    }

    let cd = cashFromPositive;
    let od = overdraftDraw;
    let mg = marginDraw;
    let sec = skInvestmentInR;
    let primarySum =
      cd + od + mg + sec + catParts.reduce((s, c) => s + c.value, 0);
    if (primarySum > needMid + 0.05 && needMid > 0.01) {
      const f = needMid / primarySum;
      cd = Math.round(cd * f * 100) / 100;
      od = Math.round(od * f * 100) / 100;
      mg = Math.round(mg * f * 100) / 100;
      sec = Math.round(sec * f * 100) / 100;
      catParts = catParts.map((c) => ({
        ...c,
        value: Math.round(c.value * f * 100) / 100,
      }));
      primarySum =
        cd + od + mg + sec + catParts.reduce((s, c) => s + c.value, 0);
    }

    let creditExtra = Math.max(0, Math.round((needMid - primarySum) * 100) / 100);

    const srcSlug = (label, i) =>
      `src_${String(label)
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')}_${i}`;

    const sourceSlices = [];
    if (cd > 0.01) {
      sourceSlices.push({
        id: 'src_cash_balance_used',
        label: 'Cash balance used',
        value: cd,
        isCash: true,
      });
    }
    if (od > 0.01) {
      sourceSlices.push({
        id: 'src_overdraft',
        label: 'Overdraft / line used',
        value: od,
        isOverdraft: true,
      });
    }
    if (mg > 0.01) {
      sourceSlices.push({
        id: 'src_margin',
        label: 'Margin / negative cash',
        value: mg,
        isMargin: true,
      });
    }
    catParts.forEach((c, i) => {
      if (c.value > 0.01) {
        sourceSlices.push({
          id: srcSlug(c.label, i),
          label: c.label,
          value: c.value,
        });
      }
    });
    if (sec > 0.01) {
      sourceSlices.push({
        id: 'src_securities_trading_sales',
        label: 'Securities trading (sales)',
        value: sec,
      });
    }
    if (creditExtra > 0.01) {
      sourceSlices.push({
        id: 'src_credit_utilized',
        label: 'Credit utilized',
        value: creditExtra,
        isCredit: true,
      });
    }

    const sliceTotal = sourceSlices.reduce((s, x) => s + x.value, 0);
    if (needMid > 0.01 && sliceTotal < 0.01) {
      sourceSlices.length = 0;
      sourceSlices.push({
        id: 'src_credit_utilized',
        label: 'Credit utilized',
        value: needMid,
        isCredit: true,
      });
    }

    return {
      cashInflow: cashInflowR,
      spending: spendingR,
      investmentOut: investmentOutR,
      transfersOut: transfersOutR,
      uncategorizedOut: uncategorizedOutR,
      securitiesSalesInflow: securitiesSalesR,
      savings: net,
      categoryBreakdowns,
      investmentOutTotal: investmentOutR,
      cashBounds: cashBoundsInner,
      sourceSlices,
      sankeySpendingTotal: skSpendingR,
      sankeyInvestmentOutTotal: skInvestmentOutR,
      sankeyTransfersOutTotal: skTransfersOutR,
      sankeyUncategorizedOutTotal: skUncategorizedOutR,
      sankeyTransfersOutSelf: skSelfR,
      sankeyTransfersOutEtransfer: skEtrfR,
      sankeySavingsFlow: skSavingsFlow,
      sankeySankeyMode: skSankeyMode,
      sankeySpendingCategoryBreakdowns: skSpendingCategoryBreakdowns,
    };
  }, [
    filteredByDate,
    displayCurrency,
    toCadMap,
    startDate,
    endDate,
    balances,
    accounts,
    transactions,
    activeCashflowAccountIds,
  ]);

  const cashEstimateAccountPartition = useMemo(() => {
    if (!startDate || !endDate || !Array.isArray(balances) || balances.length === 0) {
      return { included: [], missingAnchor: [], notApplicableType: [] };
    }
    const targetCcy = displayCurrency || 'CAD';
    const conv = (amt, txCurrency) =>
      convertViaCad(amt, txCurrency || 'CAD', targetCcy, toCadMap);
    return partitionCashEstimateAccounts({
      accounts,
      accountIds: activeCashflowAccountIds,
      balanceRows: balances,
      allTransactions: transactions || [],
      startDate,
      conv,
    });
  }, [accounts, activeCashflowAccountIds, balances, transactions, startDate, endDate, displayCurrency, toCadMap]);

  const cashflowFootnotes = useMemo(() => {
    const p = cashEstimateAccountPartition;
    const hasAccountDetails =
      (p.included?.length ?? 0) > 0 ||
      (p.missingAnchor?.length ?? 0) > 0 ||
      (p.notApplicableType?.length ?? 0) > 0;

    const entries = [];

    if (startDate && endDate) {
      entries.push({
        key: 'balances',
        element: (
          <p className="cashflow-tab-footnote-p">
            Cash at start/end of this range needs statement balances (depository: statement lines; TFSA/brokerage:
            cash-only balances). The summary cards use cash inflow and outflow buckets (see Notes); that logic can differ
            from this balance bridge, which uses the full transaction ledger.
          </p>
        ),
      });
    }

    if (startDate && endDate && hasAccountDetails) {
      entries.push({
        key: 'accounts',
        element: (
          <div className="cashflow-tab-footnote-detail">
            {p.included.length > 0 && (
              <p>
                <strong>Included in the cash total above:</strong>{' '}
                {p.included.map((a) => a.name).join('; ')}.
              </p>
            )}
            {p.missingAnchor.length > 0 && (
              <p>
                No statement balance on file before {startDate} for:{' '}
                {p.missingAnchor.map((a) => a.name).join('; ')}. They are omitted from the opening/closing estimate;
                their transactions still count toward the cash-flow summary when those accounts are selected.
              </p>
            )}
            {p.notApplicableType.length > 0 && (
              <p>
                Not part of that cash estimate (not depository / investment cash ledger):{' '}
                {p.notApplicableType.map((a) => a.name).join('; ')}.
              </p>
            )}
          </div>
        ),
      });
    }

    entries.push({
      key: 'sankey',
      element: (
        <p className="cashflow-tab-footnote-p">
          Summary cards and Sankey use the same rules: cash inflow (all counted positive amounts); spending (negative
          amounts except securities purchases, E-Transfer, Self-Transfer, and Uncategorized); investments (securities
          purchases only); transfers out (E-Transfer and Self-Transfer outflows); uncategorized out (Uncategorized
          outflows). Linked internal pairs are omitted only when both legs are in the current date and account filter—if
          only one leg appears, it stays in the totals. Credit card payments and reimbursement/loan categories follow the
          same paired omission rules as before.
        </p>
      ),
    });

    return entries.map((e, i) => ({ ...e, num: i + 1 }));
  }, [startDate, endDate, cashEstimateAccountPartition]);

  const formatCurrency = useCallback(
    (value) => formatMoney(value, displayCurrency || 'CAD', { minimumFractionDigits: 0 }),
    [displayCurrency]
  );

  const handleStartDateChange = useCallback((e) => {
    setStartDate(e.target.value);
    setDatesPinned(true);
  }, []);

  const handleEndDateChange = useCallback((e) => {
    setEndDate(e.target.value);
    setDatesPinned(true);
  }, []);

  const handleClearDateFilter = useCallback(() => {
    setDatesPinned(false);
  }, []);

  const {
    cashInflowBreakdownRows,
    spendingBreakdownRows,
    transfersBreakdownRows,
    investmentBreakdownRows,
    uncategorizedOutBreakdownRows,
  } = useMemo(() => {
    const inflowRows = [];
    const spendingRows = [];
    const transfersRows = [];
    const investmentRows = [];
    const uncatOutRows = [];
    for (const item of categoryBreakdowns) {
      const cat = item.category;
      if (cat === SECURITIES_TRADING_CATEGORY) {
        if (item.amount !== 0) investmentRows.push(item);
        continue;
      }
      if (cat === SELF_TRANSFER_CATEGORY || cat === ETRANSFER_CATEGORY) {
        if (item.amount !== 0) transfersRows.push(item);
        continue;
      }
      if (cat === UNCATEGORIZED_CATEGORY) {
        if (item.amount > 0) inflowRows.push(item);
        else if (item.amount < 0) uncatOutRows.push(item);
        continue;
      }
      if (item.amount > 0) inflowRows.push(item);
      else if (item.amount < 0) spendingRows.push(item);
    }
    const byAbs = (a, b) => Math.abs(b.amount) - Math.abs(a.amount);
    inflowRows.sort(byAbs);
    spendingRows.sort(byAbs);
    transfersRows.sort(byAbs);
    investmentRows.sort(byAbs);
    uncatOutRows.sort(byAbs);
    return {
      cashInflowBreakdownRows: inflowRows,
      spendingBreakdownRows: spendingRows,
      transfersBreakdownRows: transfersRows,
      investmentBreakdownRows: investmentRows,
      uncategorizedOutBreakdownRows: uncatOutRows,
    };
  }, [categoryBreakdowns]);

  const netCashflow = savings;
  const netCashflowClass =
    netCashflow > 0 ? 'cashflow-metric-value-positive' : netCashflow < 0 ? 'cashflow-metric-value-negative' : 'cashflow-metric-value-zero';

  const hasData = (transactions || []).length > 0 && (accounts || []).length > 0;
  const hasEligibleData = transactionsByCashflowAccounts.length > 0;

  if (loading) {
    return (
      <div className="cashflow-tab">
        <div className="cashflow-tab-loading">Loading cash flow data…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cashflow-tab">
        <div className="cashflow-tab-error">{error}</div>
      </div>
    );
  }

  if (!hasData || !hasEligibleData) {
    return (
      <div className="cashflow-tab">
        <div className="cashflow-tab-empty">
          <p>No cash flow data yet.</p>
          <p className="cashflow-tab-empty-hint">
            Connect your bank or upload statements to see cash inflow, outflows, and category breakdown here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cashflow-tab">
      {/* Date range + account filter */}
      <section className="cashflow-tab-section cashflow-tab-date-section">
        <div className="glass-card cashflow-tab-date-card">
          <div className="cashflow-tab-date-row">
            <label className="cashflow-tab-date-label">
              <span className="cashflow-tab-date-label-text">From</span>
              <input
                type="date"
                value={startDate}
                onChange={handleStartDateChange}
                className="cashflow-tab-date-input"
              />
            </label>
            <label className="cashflow-tab-date-label">
              <span className="cashflow-tab-date-label-text">To</span>
              <input
                type="date"
                value={endDate}
                onChange={handleEndDateChange}
                className="cashflow-tab-date-input"
              />
            </label>
            {datesPinned && (
              <button
                type="button"
                className="cashflow-tab-date-clear"
                onClick={handleClearDateFilter}
                title="Clear custom range and use auto month"
                aria-label="Clear custom date range"
              >
                <X size={18} strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="cashflow-tab-ccy-row">
            <label className="cashflow-tab-ccy-label">
              <span className="cashflow-tab-date-label-text">Display currency</span>
              <select
                className="cashflow-tab-ccy-select"
                value={displayCurrency}
                onChange={handleDisplayCurrencyChange}
                aria-label="Display currency"
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            {fxAsOf ? (
              <span className="cashflow-tab-ccy-asof">Rates as of {fxAsOf}</span>
            ) : null}
          </div>
          {cashflowAccounts.length > 0 && (
            <div className="cashflow-tab-account-filter-row">
              <span className="cashflow-tab-account-filter-label">Accounts</span>
              <div className="cashflow-tab-account-pills">
                <button
                  type="button"
                  className={
                    selectedAccounts.length === 0
                      ? 'cashflow-tab-account-pill cashflow-tab-account-pill-active'
                      : 'cashflow-tab-account-pill'
                  }
                  onClick={() => setSelectedAccounts([])}
                >
                  All Accounts
                </button>
                {cashflowAccounts.map((account) => {
                  const isActive = selectedAccounts.includes(account.id);
                  return (
                    <button
                      key={account.id}
                      type="button"
                      className={
                        isActive
                          ? 'cashflow-tab-account-pill cashflow-tab-account-pill-active'
                          : 'cashflow-tab-account-pill'
                      }
                      onClick={() => {
                        setSelectedAccounts((prev) => {
                          if (prev.includes(account.id)) {
                            return prev.filter((id) => id !== account.id);
                          }
                          return [...prev, account.id];
                        });
                      }}
                    >
                      {account.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Cash Flow: metric cards + chart */}
      <section className="cashflow-tab-section">
        <h2 className="cashflow-tab-section-title">Cash Flow</h2>
        <div className="cashflow-metrics-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
          <div className="glass-card cashflow-metric-card">
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Cash inflow</span>
              <TrendingUp size={16} className="cashflow-metric-icon" />
            </div>
            <span className="cashflow-metric-value text-3xl font-bold text-slate-50">{formatCurrency(cashInflow)}</span>
            {securitiesSalesInflow > 0 && (
              <span className="cashflow-metric-sub text-sm text-slate-400" title="Included in cash inflow">
                Incl. securities sales +{formatCurrency(securitiesSalesInflow)}
              </span>
            )}
          </div>
          <div className="glass-card cashflow-metric-card">
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Spending</span>
              <TrendingDown size={16} className="cashflow-metric-icon" />
            </div>
            <span className="cashflow-metric-value text-3xl font-bold text-slate-50">{formatCurrency(spending)}</span>
          </div>
          <div className="glass-card cashflow-metric-card">
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Investments</span>
              <Briefcase size={16} className="cashflow-metric-icon" />
            </div>
            <span className="cashflow-metric-value text-3xl font-bold text-slate-50">{formatCurrency(investmentOut)}</span>
            <span className="cashflow-metric-sub text-sm text-slate-400">Securities purchases (cash out)</span>
          </div>
          <div
            className="glass-card cashflow-metric-card"
            title="E-Transfer and Self-Transfer outflows in this period"
          >
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Transfers out</span>
              <ArrowLeftRight size={16} className="cashflow-metric-icon" />
            </div>
            <span className="cashflow-metric-value text-3xl font-bold text-slate-50">{formatCurrency(transfersOut)}</span>
          </div>
          <div
            className="glass-card cashflow-metric-card"
            title="Outflows still assigned to the Uncategorized category"
          >
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Uncategorized out</span>
              <CircleHelp size={16} className="cashflow-metric-icon" />
            </div>
            <span className="cashflow-metric-value text-3xl font-bold text-slate-50">{formatCurrency(uncategorizedOut)}</span>
          </div>
          <div className="glass-card cashflow-metric-card">
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Net cashflow</span>
              <Wallet size={16} className="cashflow-metric-icon" />
            </div>
            <span className={`cashflow-metric-value text-3xl font-bold ${netCashflowClass}`}>{formatCurrency(netCashflow)}</span>
          </div>
        </div>
        {startDate && endDate ? (
          <>
            {cashBounds.allKnown && cashBounds.anyIncluded ? (
              <p className="cashflow-tab-balance-est">
                Estimated cash (depository + investment cash ledger):{' '}
                <strong>{formatCurrency(cashBounds.openingSum)}</strong> before {startDate} →{' '}
                <strong>{formatCurrency(cashBounds.closingSum)}</strong> after {endDate}. Uses statement balances and the
                full transaction ledger (not the same netting rules as the summary cards).
                <CashflowFootnoteRef footnotes={cashflowFootnotes} fnKey="balances" />
                <CashflowFootnoteRef footnotes={cashflowFootnotes} fnKey="accounts" />
              </p>
            ) : (
              <p className="cashflow-tab-balance-est cashflow-tab-balance-est-muted">
                Start/end cash for this range cannot be fully estimated from balances on file.
                <CashflowFootnoteRef footnotes={cashflowFootnotes} fnKey="balances" />
                <CashflowFootnoteRef footnotes={cashflowFootnotes} fnKey="accounts" />
              </p>
            )}
          </>
        ) : null}
        <div className="glass-card cashflow-tab-sankey-wrapper cashflow-tab-sankey-card">
          <div className="cashflow-tab-sankey-intro">
            <span className="cashflow-tab-sankey-intro-label">Money flow</span>
            <CashflowFootnoteRef footnotes={cashflowFootnotes} fnKey="sankey" />
          </div>
          <CashflowSankey
            spendingTotal={sankeySpendingTotal}
            investmentOutTotal={sankeyInvestmentOutTotal}
            transfersOutTotal={sankeyTransfersOutTotal}
            uncategorizedOutTotal={sankeyUncategorizedOutTotal}
            transfersOutSelf={sankeyTransfersOutSelf}
            transfersOutEtransfer={sankeyTransfersOutEtransfer}
            savingsFlow={sankeySavingsFlow}
            sankeyMode={sankeySankeyMode}
            spendingCategoryBreakdowns={sankeySpendingCategoryBreakdowns}
            sourceSlices={sourceSlices}
            formatCurrency={formatCurrency}
          />
        </div>
      </section>

      {/* Category Breakdown */}
      <section className="cashflow-tab-section">
        <h2 className="cashflow-tab-section-title">Category Breakdown</h2>
        <div className="glass-card cashflow-tab-list">
          {categoryBreakdowns.length === 0 ? (
            <div className="cashflow-tab-item cashflow-tab-item-empty">No transactions in this period</div>
          ) : (
            <>
              {cashInflowBreakdownRows.length > 0 && (
                <>
                  <div className="cashflow-tab-breakdown-heading">Cash inflow</div>
                  {cashInflowBreakdownRows.map((item, i) => (
                    <div key={`in-${i}`} className="cashflow-tab-item">
                      <span className="cashflow-tab-category">{item.category}</span>
                      <span className="cashflow-tab-amount cashflow-tab-amount-positive">
                        +{formatCurrency(item.amount)}
                      </span>
                    </div>
                  ))}
                </>
              )}
              {spendingBreakdownRows.length > 0 && (
                <>
                  <div className="cashflow-tab-breakdown-heading">Spending</div>
                  {spendingBreakdownRows.map((item, i) => (
                    <div key={`sp-${i}`} className="cashflow-tab-item">
                      <span className="cashflow-tab-category">{item.category}</span>
                      <span className="cashflow-tab-amount cashflow-tab-amount-negative">
                        {formatCurrency(item.amount)}
                      </span>
                    </div>
                  ))}
                </>
              )}
              {investmentBreakdownRows.length > 0 && (
                <>
                  <div className="cashflow-tab-breakdown-heading">Investments (securities)</div>
                  {investmentBreakdownRows.map((item, i) => {
                    const isIncome = item.amount > 0;
                    const amountClass = isIncome ? 'cashflow-tab-amount-positive' : 'cashflow-tab-amount-negative';
                    const signed = isIncome ? `+${formatCurrency(item.amount)}` : formatCurrency(item.amount);
                    return (
                      <div key={`inv-${i}`} className="cashflow-tab-item">
                        <span className="cashflow-tab-category">{item.category}</span>
                        <span className={`cashflow-tab-amount ${amountClass}`}>{signed}</span>
                      </div>
                    );
                  })}
                </>
              )}
              {transfersBreakdownRows.length > 0 && (
                <>
                  <div className="cashflow-tab-breakdown-heading">Transfers (E-Transfer &amp; Self-Transfer)</div>
                  {transfersBreakdownRows.map((item, i) => {
                    const isIn = item.amount > 0;
                    const amountClass = isIn ? 'cashflow-tab-amount-positive' : 'cashflow-tab-amount-negative';
                    const signed = isIn ? `+${formatCurrency(item.amount)}` : formatCurrency(item.amount);
                    return (
                      <div key={`tr-${i}`} className="cashflow-tab-item">
                        <span className="cashflow-tab-category">{item.category}</span>
                        <span className={`cashflow-tab-amount ${amountClass}`}>{signed}</span>
                      </div>
                    );
                  })}
                </>
              )}
              {uncategorizedOutBreakdownRows.length > 0 && (
                <>
                  <div className="cashflow-tab-breakdown-heading">Uncategorized out</div>
                  {uncategorizedOutBreakdownRows.map((item, i) => (
                    <div key={`uc-${i}`} className="cashflow-tab-item">
                      <span className="cashflow-tab-category">{item.category}</span>
                      <span className="cashflow-tab-amount cashflow-tab-amount-negative">
                        {formatCurrency(item.amount)}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </section>

      {cashflowFootnotes.length > 0 ? (
        <footer className="cashflow-tab-footnotes" aria-label="Cash flow notes">
          <h3 className="cashflow-tab-footnotes-heading">Notes</h3>
          <ol className="cashflow-tab-footnotes-list">
            {cashflowFootnotes.map((f) => (
              <li key={f.key} id={`cashflow-fn-${f.key}`} className="cashflow-tab-footnotes-item">
                {f.element}
              </li>
            ))}
          </ol>
        </footer>
      ) : null}
    </div>
  );
}
