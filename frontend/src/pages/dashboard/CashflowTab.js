import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAnalysis } from '../../context/AnalysisContext';
import CashflowSankey from '../../components/CashflowSankey';
import './CashflowTab.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

const CASHFLOW_ACCOUNT_TYPES = ['depository', 'credit', 'loan'];

// Transactions in these categories are excluded from income/expense totals
// even when they fall within the selected accounts/date range.
const CASHFLOW_EXCLUDE_CATEGORIES = ['Credit Card Payment', 'Self-Transfer', 'Reimbursements & Loans'];

function excludeFromIncomeExpense(tx) {
  return tx.is_transfer === true || (tx.category && CASHFLOW_EXCLUDE_CATEGORIES.includes(tx.category));
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

export default function CashflowTab() {
  const { getAccessToken } = useAuth();
  const { transactions, accounts, setAnalysisData } = useAnalysis();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState([]);

  const token = getAccessToken?.();

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

  const defaultRange = useMemo(
    () => getLatestCalendarMonthFromTransactions(transactionsByCashflowAccounts),
    [transactionsByCashflowAccounts]
  );

  useEffect(() => {
    if (defaultRange && !startDate && !endDate) {
      setStartDate(defaultRange.startDate);
      setEndDate(defaultRange.endDate);
    }
  }, [defaultRange, startDate, endDate]);

  const filteredByDate = useMemo(() => {
    const list = transactionsBySelectedAccounts;
    if (!startDate || !endDate) return list;
    return list.filter((tx) => {
      const d = tx.date;
      return d && d >= startDate && d <= endDate;
    });
  }, [transactionsBySelectedAccounts, startDate, endDate]);

  const { income, expenses, savings, categoryBreakdowns, sankeyMode, savingsFlow, creditDeficitFlow } = useMemo(() => {
    const list = filteredByDate;
    let incomeSum = 0;
    let expenseSum = 0;
    /** category -> net signed amount (positive = income, negative = expense) */
    const byCategory = {};

    for (const tx of list) {
      if (excludeFromIncomeExpense(tx)) continue;
      const amount = Number(tx.amount) || 0;
      const cat = tx.category || 'Uncategorized';
      if (amount > 0) {
        incomeSum += amount;
        byCategory[cat] = (byCategory[cat] || 0) + amount;
      } else if (amount < 0) {
        const absAmount = Math.abs(amount);
        expenseSum += absAmount;
        byCategory[cat] = (byCategory[cat] || 0) - absAmount;
      }
    }

    const categoryBreakdowns = Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    const incomeR = Math.round(incomeSum * 100) / 100;
    const expensesR = Math.round(expenseSum * 100) / 100;
    const net = incomeR - expensesR;
    const savingsFlow = net > 0 ? Math.round(net * 100) / 100 : 0;
    const creditDeficitFlow = net < 0 ? Math.round(Math.abs(net) * 100) / 100 : 0;
    const sankeyMode = net >= 0 ? 'surplus' : 'deficit';

    return {
      income: incomeR,
      expenses: expensesR,
      savings: Math.round((incomeSum - expenseSum) * 100) / 100,
      categoryBreakdowns,
      sankeyMode,
      savingsFlow,
      creditDeficitFlow,
    };
  }, [filteredByDate]);

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(value);

  const netCashflow = savings; // income - expenses, already rounded
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
          <p className="cashflow-tab-empty-hint">Connect your bank or upload statements to see income, expenses, and category breakdown here.</p>
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
                onChange={(e) => setStartDate(e.target.value)}
                className="cashflow-tab-date-input"
              />
            </label>
            <label className="cashflow-tab-date-label">
              <span className="cashflow-tab-date-label-text">To</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="cashflow-tab-date-input"
              />
            </label>
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
        <div className="cashflow-metrics-grid grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="glass-card cashflow-metric-card">
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Total Income</span>
              <TrendingUp size={16} className="cashflow-metric-icon" />
            </div>
            <span className="cashflow-metric-value text-3xl font-bold text-slate-50">{formatCurrency(income)}</span>
          </div>
          <div className="glass-card cashflow-metric-card">
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Total Expenses</span>
              <TrendingDown size={16} className="cashflow-metric-icon" />
            </div>
            <span className="cashflow-metric-value text-3xl font-bold text-slate-50">{formatCurrency(expenses)}</span>
          </div>
          <div className="glass-card cashflow-metric-card">
            <div className="cashflow-metric-header">
              <span className="cashflow-metric-label">Net Cashflow</span>
              <Wallet size={16} className="cashflow-metric-icon" />
            </div>
            <span className={`cashflow-metric-value text-3xl font-bold ${netCashflowClass}`}>{formatCurrency(netCashflow)}</span>
          </div>
        </div>
        <div className="glass-card cashflow-tab-sankey-wrapper cashflow-tab-sankey-card">
          <CashflowSankey
            income={income}
            expenses={expenses}
            savings={savings}
            savingsFlow={savingsFlow}
            creditDeficitFlow={creditDeficitFlow}
            sankeyMode={sankeyMode}
            categoryBreakdowns={categoryBreakdowns}
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
            categoryBreakdowns.map((item, i) => {
              const isIncome = item.amount > 0;
              const amountClass = isIncome ? 'cashflow-tab-amount-positive' : 'cashflow-tab-amount-negative';
              const signed = isIncome ? `+${formatCurrency(item.amount)}` : formatCurrency(item.amount);
              return (
                <div key={i} className="cashflow-tab-item">
                  <span className="cashflow-tab-category">{item.category}</span>
                  <span className={`cashflow-tab-amount ${amountClass}`}>{signed}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
