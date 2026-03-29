import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAnalysis } from '../../context/AnalysisContext';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { formatMoney } from '../../utils/money';
import './DashboardTab.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';
const API_TIMEOUT_MS = 20000;

function formatCurrency(value, currency = 'CAD') {
  return formatMoney(value, currency, { minimumFractionDigits: 0 });
}

function MetricSkeleton() {
  return <div className="dashboard-tab-skeleton" aria-hidden />;
}

export default function DashboardTab() {
  const { getAccessToken, user } = useAuth();
  const { transactions: ctxTransactions, setAnalysisData } = useAnalysis();

  const [accounts, setAccounts] = useState([]);
  const [toCadMap, setToCadMap] = useState({ CAD: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Use transactions already in context if available; otherwise fetched below
  const transactions = ctxTransactions || [];

  const fetchData = useCallback(async () => {
    const token = getAccessToken?.();
    if (!token || !user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [userDataRes, accountsRes, fxRes] = await Promise.all([
        // Only fetch user_data if context is empty (another tab may have already fetched)
        ctxTransactions?.length > 0
          ? Promise.resolve(null)
          : axios.get(`${API_BASE}/api/user_data`, {
              headers: { Authorization: `Bearer ${token}` },
              timeout: API_TIMEOUT_MS,
            }),
        axios.get(`${API_BASE}/api/accounts_with_balances`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_BASE}/api/exchange_rates`),
      ]);

      if (userDataRes) {
        setAnalysisData(userDataRes.data);
      }

      setAccounts(accountsRes.data?.accounts ?? []);

      const toCad = fxRes.data?.to_cad;
      if (toCad && typeof toCad === 'object') {
        setToCadMap({ CAD: 1, ...toCad });
      }
    } catch (e) {
      console.error('Dashboard fetch error:', e);
      setError(e.response?.data?.detail || e.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [user?.id, getAccessToken, ctxTransactions?.length, setAnalysisData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // accounts state is sourced exclusively from /api/accounts_with_balances (which includes
  // the latest balance per account/currency). AnalysisContext accounts do NOT carry the
  // balances array, so we never sync from ctxAccounts here.

  const { netWorth, runwayMonths, avgMonthlySpend, inflation, hasData } = useDashboardMetrics({
    accounts,
    transactions,
    toCadMap,
  });

  if (error) {
    return (
      <div className="dashboard-tab">
        <div className="dashboard-tab-error glass-card">
          <p>{error}</p>
          <button className="dashboard-tab-retry" onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-tab">
      {/* Hero Metric Cards */}
      <section className="dashboard-tab-hero-grid">
        {/* Net Worth */}
        <div className="glass-card dashboard-tab-hero-card dashboard-tab-hero-card-networth">
          <h3 className="dashboard-tab-hero-label">Net Worth</h3>
          {loading ? (
            <MetricSkeleton />
          ) : !hasData ? (
            <p className="dashboard-tab-hero-value dashboard-tab-empty-value">—</p>
          ) : (
            <p className={`dashboard-tab-hero-value ${netWorth < 0 ? 'dashboard-tab-value-negative' : ''}`}>
              {formatCurrency(netWorth)}
            </p>
          )}
          <span className="dashboard-tab-badge">Assets minus liabilities</span>
        </div>

        {/* Personal Runway */}
        <div className="glass-card dashboard-tab-hero-card">
          <h3 className="dashboard-tab-hero-label">Personal Runway</h3>
          {loading ? (
            <MetricSkeleton />
          ) : runwayMonths === null || !hasData ? (
            <p className="dashboard-tab-hero-value dashboard-tab-empty-value">—</p>
          ) : (
            <p className="dashboard-tab-hero-value">{runwayMonths} Months</p>
          )}
          {avgMonthlySpend > 0 && !loading && (
            <span className="dashboard-tab-badge">
              Avg. monthly spend: {formatCurrency(avgMonthlySpend)}
            </span>
          )}
          {(!avgMonthlySpend || loading) && (
            <span className="dashboard-tab-badge">Liquid cash ÷ monthly spend</span>
          )}
        </div>

        {/* Personal Inflation */}
        <div className="glass-card dashboard-tab-hero-card">
          <h3 className="dashboard-tab-hero-label">Personal Inflation</h3>
          {loading ? (
            <MetricSkeleton />
          ) : !inflation ? (
            <p className="dashboard-tab-hero-value dashboard-tab-empty-value">—</p>
          ) : (
            <div className="dashboard-tab-inflation-row">
              <p className="dashboard-tab-hero-value">
                {inflation.value >= 0 ? '+' : ''}{inflation.value}% {inflation.period}
              </p>
              {inflation.trend === 'up' ? (
                <TrendingUp className="dashboard-tab-trend-icon dashboard-tab-trend-up" aria-hidden />
              ) : (
                <TrendingDown className="dashboard-tab-trend-icon dashboard-tab-trend-down" aria-hidden />
              )}
            </div>
          )}
          {inflation?.highestCategory && !loading && (
            <span className="dashboard-tab-badge">
              Highest: {inflation.highestCategory.name} {inflation.highestCategory.change >= 0 ? '+' : ''}{inflation.highestCategory.change}%
            </span>
          )}
          {(!inflation || loading) && (
            <span className="dashboard-tab-badge">
              {!loading && !inflation ? 'Not enough history yet' : 'Spending change vs prior period'}
            </span>
          )}
        </div>
      </section>

      {/* Empty state nudge for new users */}
      {!loading && !hasData && (
        <section className="glass-card dashboard-tab-empty-state">
          <p className="dashboard-tab-empty-title">No financial data yet</p>
          <p className="dashboard-tab-empty-desc">
            Upload a bank statement to see your net worth, runway, and spending insights.
          </p>
        </section>
      )}
    </div>
  );
}
