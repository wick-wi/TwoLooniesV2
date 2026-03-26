import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsivePie } from '@nivo/pie';
import { useAuth } from '../../context/AuthContext';
import { useAnalysis } from '../../context/AnalysisContext';
import { useSpendingIncome } from '../../hooks/useSpendingIncome';
import { formatMoney } from '../../utils/money';
import { sortedCurrencyCodes } from '../../utils/fx';
import SpendingLedgerTable from '../../components/SpendingLedgerTable';
import { CATEGORY_PILL_CLASS } from '../../components/CategoryPill';
import './SpendingIncomeTab.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';
const PAGE_SIZE = 20;
const DISPLAY_CCY_LS = 'tl_si_display_ccy';
const DATE_PREFS_PREFIX = 'tl_si_dates_';

const DONUT_COLORS = [
  '#f59e0b',
  '#10b981',
  '#38bdf8',
  '#8b5cf6',
  '#f43f5e',
  '#14b8a6',
  '#6366f1',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#a855f7',
];

// ── Date preset helpers ───────────────────────────────────────────────────────
function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function buildPresets() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed

  const firstOfThisMonth = new Date(y, m, 1);
  const lastOfThisMonth = new Date(y, m + 1, 0);
  const firstOfLastMonth = new Date(y, m - 1, 1);
  const lastOfLastMonth = new Date(y, m, 0);

  const minus3 = new Date(y, m - 2, 1);
  const minus6 = new Date(y, m - 5, 1);
  const ytdStart = new Date(y, 0, 1);

  return [
    { label: 'This Month', start: toIso(firstOfThisMonth), end: toIso(lastOfThisMonth) },
    { label: 'Last Month', start: toIso(firstOfLastMonth), end: toIso(lastOfLastMonth) },
    { label: 'Last 3 Months', start: toIso(minus3), end: toIso(lastOfThisMonth) },
    { label: 'Last 6 Months', start: toIso(minus6), end: toIso(lastOfThisMonth) },
    { label: 'Year-to-Date', start: toIso(ytdStart), end: toIso(lastOfThisMonth) },
  ];
}

// ── Nivo chart themes ─────────────────────────────────────────────────────────
const NIVO_THEME = {
  background: 'transparent',
  text: {
    fill: '#fafcff',
    fontSize: 11,
  },
  axis: {
    domain: {
      line: {
        stroke: '#3f3f46',
      },
    },
    ticks: { text: { fill: '#a1a1aa', fontSize: 11 } },
    legend: { text: { fill: '#a1a1aa' } },
  },
  grid: { line: { stroke: '#27272a' } },
  tooltip: {
    container: {
      background: '#18181b',
      color: '#fafcff',
      border: '1px solid #27272a',
      borderRadius: '12px',
      boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
      padding: 0,
    },
  },
  legends: { text: { fill: '#a1a1aa', fontSize: 11 } },
  labels: { text: { fill: '#fafcff', fontSize: 11, fontWeight: 600 } },
};

// ── Custom bar tooltip ────────────────────────────────────────────────────────
function BarTooltip({ data, formatCurrency }) {
  const net = (data.income || 0) - (data.spending || 0);
  const netClass = net > 0 ? 'si-net-positive' : net < 0 ? 'si-net-negative' : 'si-net-zero';
  return (
    <div className="si-bar-tooltip">
      <div className="si-bar-tooltip-title">{data.month}</div>
      <div className="si-bar-tooltip-row">
        <span className="si-bar-tooltip-dot" style={{ background: '#34d399' }} />
        <span>Income:</span>
        <span className="si-tooltip-value">{formatCurrency(data.income || 0)}</span>
      </div>
      <div className="si-bar-tooltip-row">
        <span className="si-bar-tooltip-dot" style={{ background: '#fb7185' }} />
        <span>Spending:</span>
        <span className="si-tooltip-value">{formatCurrency(data.spending || 0)}</span>
      </div>
      <div className={`si-bar-tooltip-row si-bar-tooltip-net ${netClass}`}>
        <span>Net:</span>
        <span className="si-tooltip-value">{net >= 0 ? '+' : ''}{formatCurrency(net)}</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SpendingIncomeTab() {
  const { getAccessToken, user } = useAuth();
  const { transactions, accounts, setAnalysisData } = useAnalysis();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fxPayload, setFxPayload] = useState(null);
  const [displayCurrency, setDisplayCurrency] = useState('CAD');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activePreset, setActivePreset] = useState(null);

  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerCategory, setLedgerCategory] = useState(null); // null = all
  const [categoryEmojiByName, setCategoryEmojiByName] = useState({});

  const token = getAccessToken?.();
  const presets = useMemo(() => buildPresets(), []);
  const datePrefsKey = user?.id ? `${DATE_PREFS_PREFIX}${user.id}` : null;

  // ── FX rates ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/exchange_rates`);
        if (cancelled) return;
        const data = res.data || {};
        const toCad = data.to_cad && typeof data.to_cad === 'object' ? data.to_cad : { CAD: 1 };
        setFxPayload({ base: data.base || 'CAD', as_of: data.as_of || '', to_cad: toCad });
        const codes = sortedCurrencyCodes(toCad);
        let sel = 'CAD';
        try {
          const saved = localStorage.getItem(DISPLAY_CCY_LS);
          if (saved && codes.includes(saved)) sel = saved;
        } catch { /* ignore */ }
        setDisplayCurrency(sel);
      } catch {
        if (!cancelled) {
          setFxPayload({ base: 'CAD', as_of: '', to_cad: { CAD: 1 } });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Category emoji lookup (from /api/categories) ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/categories`);
        const list = res?.data?.categories;
        if (cancelled || !Array.isArray(list)) return;
        const next = {};
        for (const c of list) {
          const name = (c?.name || '').trim();
          const label = (c?.label || '').trim();
          if (!name || !label) continue;
          // label shape: "💰 Income" → emoji is the first token
          const emoji = label.split(' ')[0];
          if (emoji) next[name] = emoji;
        }
        setCategoryEmojiByName(next);
      } catch {
        if (!cancelled) setCategoryEmojiByName({});
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Load user data ───────────────────────────────────────────────────────────
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
    if (!token) { setLoading(false); return; }
    if ((!transactions || transactions.length === 0) && (!accounts || accounts.length === 0)) {
      fetchUserData();
    } else {
      setLoading(false);
    }
  }, [token, transactions, accounts, fetchUserData]);

  // ── Date range: restore from sessionStorage or default to Last 6 Months ─────
  useEffect(() => {
    if (!token) return;
    let restored = false;
    if (datePrefsKey) {
      try {
        const raw = sessionStorage.getItem(datePrefsKey);
        if (raw) {
          const o = JSON.parse(raw);
          if (o?.start && o?.end) {
            setStartDate(o.start);
            setEndDate(o.end);
            setActivePreset(o.preset ?? null);
            restored = true;
          }
        }
      } catch { /* ignore */ }
    }
    if (!restored) {
      const last6 = presets.find((p) => p.label === 'Last 6 Months');
      if (last6) {
        setStartDate(last6.start);
        setEndDate(last6.end);
        setActivePreset('Last 6 Months');
      }
    }
  }, [token, datePrefsKey, presets]);

  // Persist date prefs to sessionStorage
  useEffect(() => {
    if (!datePrefsKey || !startDate || !endDate) return;
    try {
      sessionStorage.setItem(datePrefsKey, JSON.stringify({ start: startDate, end: endDate, preset: activePreset }));
    } catch { /* ignore */ }
  }, [datePrefsKey, startDate, endDate, activePreset]);

  const toCadMap = useMemo(() => {
    const t = fxPayload?.to_cad;
    return t && typeof t === 'object' ? t : { CAD: 1 };
  }, [fxPayload]);

  const currencyOptions = useMemo(() => sortedCurrencyCodes(toCadMap), [toCadMap]);

  const handleCurrencyChange = useCallback((e) => {
    setDisplayCurrency(e.target.value);
    try { localStorage.setItem(DISPLAY_CCY_LS, e.target.value); } catch { /* ignore */ }
  }, []);

  const handlePreset = useCallback((preset) => {
    setStartDate(preset.start);
    setEndDate(preset.end);
    setActivePreset(preset.label);
    setLedgerPage(1);
  }, []);

  const handleStartDate = useCallback((e) => {
    setStartDate(e.target.value);
    setActivePreset(null);
    setLedgerPage(1);
  }, []);

  const handleEndDate = useCallback((e) => {
    setEndDate(e.target.value);
    setActivePreset(null);
    setLedgerPage(1);
  }, []);

  const formatCurrency = useCallback(
    (value) => formatMoney(value, displayCurrency || 'CAD', { minimumFractionDigits: 0 }),
    [displayCurrency]
  );

  // ── Hook: strict filtered aggregates ────────────────────────────────────────
  const {
    totalIncome,
    totalSpending,
    savings,
    monthlyData,
    spendingByCategory,
    filteredTransactions,
  } = useSpendingIncome({
    transactions,
    startDate,
    endDate,
    toCadMap,
    displayCurrency,
  });

  // ── Ledger category pills (computed from already-filtered transactions) ─────
  const ledgerCategoryCounts = useMemo(() => {
    const counts = new Map();
    for (const tx of filteredTransactions || []) {
      const cat = (tx.category || 'Uncategorized').trim() || 'Uncategorized';
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return counts;
  }, [filteredTransactions]);

  const ledgerCategories = useMemo(() => {
    return Array.from(ledgerCategoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat);
  }, [ledgerCategoryCounts]);

  const ledgerFilteredTransactions = useMemo(() => {
    if (!ledgerCategory) return filteredTransactions;
    return (filteredTransactions || []).filter((tx) => {
      const cat = (tx.category || 'Uncategorized').trim() || 'Uncategorized';
      return cat === ledgerCategory;
    });
  }, [filteredTransactions, ledgerCategory]);

  // ── Donut data ───────────────────────────────────────────────────────────────
  const donutData = useMemo(() => {
    const entries = Object.entries(spendingByCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, value], i) => ({
        id: cat,
        label: cat,
        value,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }));
    return entries;
  }, [spendingByCategory]);

  const donutTotal = useMemo(
    () => donutData.reduce((s, d) => s + d.value, 0),
    [donutData]
  );

  // ── Pagination ───────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(ledgerFilteredTransactions.length / PAGE_SIZE));
  const pagedTransactions = ledgerFilteredTransactions.slice(
    (ledgerPage - 1) * PAGE_SIZE,
    ledgerPage * PAGE_SIZE
  );

  // ── Savings class ────────────────────────────────────────────────────────────
  const savingsClass =
    savings > 0
      ? 'si-kpi-savings-positive'
      : savings < 0
      ? 'si-kpi-savings-negative'
      : 'si-kpi-savings-zero';

  // ── Bar chart data (always show full 6-month window) ─────────────────────────
  const barData = monthlyData;

  // ── Guard states ─────────────────────────────────────────────────────────────
  const hasData = (transactions || []).length > 0;

  if (loading) {
    return (
      <div className="si-tab">
        <div className="si-tab-loading">Loading Spending & Income data…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="si-tab">
        <div className="si-tab-error">{error}</div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="si-tab">
        <div className="si-tab-empty">
          <p>No transactions found.</p>
          <p className="si-tab-empty-hint">
            Connect your bank or upload statements to see your Spending & Income summary here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="si-tab">

      {/* ── Filter bar ── */}
      <div className="glass-card si-filter-card">
        <div className="si-filter-row">
          <span className="si-filter-label">Period</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`si-preset-btn${activePreset === p.label ? ' si-preset-btn-active' : ''}`}
              onClick={() => handlePreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="si-custom-range">
          <span className="si-filter-label">Custom</span>
          <input
            type="date"
            value={startDate}
            onChange={handleStartDate}
            className="si-date-input"
            aria-label="Start date"
          />
          <span className="si-date-sep">—</span>
          <input
            type="date"
            value={endDate}
            onChange={handleEndDate}
            className="si-date-input"
            aria-label="End date"
          />
        </div>

        <div className="si-ccy-row">
          <span className="si-filter-label">Currency</span>
          <select
            className="si-ccy-select"
            value={displayCurrency}
            onChange={handleCurrencyChange}
            aria-label="Display currency"
          >
            {currencyOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {fxPayload?.as_of ? (
            <span className="si-ccy-asof">Rates as of {fxPayload.as_of}</span>
          ) : null}
        </div>
      </div>

      {/* ── Section A: KPI cards ── */}
      <section>
        <h2 className="si-section-title">Summary</h2>
        <div className="si-kpi-grid">
          <div className="glass-card si-kpi-card">
            <div className="si-kpi-label">
              <TrendingUp size={13} strokeWidth={2.5} aria-hidden />
              Total Income
            </div>
            <div className="si-kpi-value si-kpi-income">
              {formatCurrency(totalIncome)}
            </div>
          </div>

          <div className="glass-card si-kpi-card">
            <div className="si-kpi-label">
              <TrendingDown size={13} strokeWidth={2.5} aria-hidden />
              Total Spending
            </div>
            <div className="si-kpi-value si-kpi-spending">
              {formatCurrency(totalSpending)}
            </div>
          </div>

          <div className="glass-card si-kpi-card">
            <div className="si-kpi-label">
              <Wallet size={13} strokeWidth={2.5} aria-hidden />
              Savings
            </div>
            <div className={`si-kpi-value ${savingsClass}`}>
              {savings >= 0 ? '+' : ''}{formatCurrency(savings)}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section B: 6-month bar chart ── */}
      <section>
        <h2 className="si-section-title">6-Month Trend</h2>
        <div className="glass-card si-chart-card">
          <div className="si-chart-inner">
            <ResponsiveBar
              data={barData}
              keys={['income', 'spending']}
              indexBy="month"
              groupMode="grouped"
              margin={{ top: 16, right: 24, bottom: 44, left: 64 }}
              padding={0.28}
              innerPadding={3}
              colors={({ id }) => (id === 'income' ? '#34d399' : '#fb7185')}
              theme={NIVO_THEME}
              axisBottom={{
                tickSize: 0,
                tickPadding: 10,
                tickRotation: 0,
              }}
              axisLeft={{
                tickSize: 0,
                tickPadding: 8,
                format: (v) => formatCurrency(v),
              }}
              enableLabel={false}
              enableGridX={false}
              gridYValues={4}
              tooltip={({ data }) => <BarTooltip data={data} formatCurrency={formatCurrency} />}
              legends={[
                {
                  dataFrom: 'keys',
                  anchor: 'bottom',
                  direction: 'row',
                  translateY: 44,
                  itemWidth: 80,
                  itemHeight: 16,
                  itemsSpacing: 8,
                  symbolSize: 10,
                  symbolShape: 'circle',
                  data: [
                    { id: 'income', label: 'Income', color: '#34d399' },
                    { id: 'spending', label: 'Spending', color: '#fb7185' },
                  ],
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* ── Section C: Spending donut ── */}
      <section>
        <h2 className="si-section-title">Spending Breakdown</h2>
        {donutData.length === 0 ? (
          <div className="glass-card si-kpi-card">
            <span className="si-empty-copy">
              No spending data for the selected period.
            </span>
          </div>
        ) : (
          <div className="si-donut-section">
            <div className="glass-card si-donut-card">
              <ResponsivePie
                data={donutData}
                margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                innerRadius={0.55}
                padAngle={0.6}
                cornerRadius={3}
                colors={({ data }) => data.color}
                borderWidth={0}
                enableArcLabels={false}
                enableArcLinkLabels={false}
                theme={NIVO_THEME}
                tooltip={({ datum }) => (
                  <div className="si-bar-tooltip">
                    <div className="si-bar-tooltip-title">
                      {categoryEmojiByName?.[datum.label]
                        ? `${categoryEmojiByName[datum.label]} ${datum.label}`
                        : datum.label}
                    </div>
                    <div className="si-bar-tooltip-row">
                      <span
                        className="si-bar-tooltip-dot"
                        style={{ background: datum.color }}
                      />
                      <span className="si-tooltip-value">{formatCurrency(datum.value)}</span>
                      {donutTotal > 0 ? (
                        <span className="si-tooltip-value">
                          ({Math.round((datum.value / donutTotal) * 100)}%)
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
              />
            </div>

            <div className="glass-card si-donut-legend-card">
              {donutData.map((d) => (
                <div key={d.id} className="si-donut-legend-item">
                  <span className="si-donut-legend-label">
                    <span
                      className="si-donut-legend-swatch"
                      style={{ background: d.color }}
                    />
                    {categoryEmojiByName?.[d.label]
                      ? `${categoryEmojiByName[d.label]} ${d.label}`
                      : d.label}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="si-donut-legend-pct">
                      {donutTotal > 0 ? `${Math.round((d.value / donutTotal) * 100)}%` : '—'}
                    </span>
                    <span className="si-donut-legend-amount">
                      {formatCurrency(d.value)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Section D: Ledger table ── */}
      <section>
        <div className="si-table-header">
          <h2 className="si-table-title">Transactions</h2>
          <span className="si-table-count">({ledgerFilteredTransactions.length})</span>
        </div>
        <div className="glass-card si-ledger-card">
          {ledgerFilteredTransactions.length === 0 ? (
            <p className="si-table-empty">
              No transactions match the current filters.
            </p>
          ) : (
            <>
              <div className="px-6 pt-5 pb-3 border-b border-zinc-800">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setLedgerCategory(null); setLedgerPage(1); }}
                    className={[
                      CATEGORY_PILL_CLASS,
                      'cursor-pointer transition-colors',
                      ledgerCategory == null ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' : 'hover:text-zinc-100',
                    ].join(' ')}
                    aria-pressed={ledgerCategory == null}
                  >
                    ALL
                  </button>
                  {ledgerCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => { setLedgerCategory(cat); setLedgerPage(1); }}
                      className={[
                        CATEGORY_PILL_CLASS,
                        'cursor-pointer transition-colors',
                        ledgerCategory === cat ? 'bg-amber-500/10 border-amber-500/40 text-amber-300' : 'hover:text-zinc-100',
                      ].join(' ')}
                      aria-pressed={ledgerCategory === cat}
                      title={`${cat} (${ledgerCategoryCounts.get(cat) || 0})`}
                    >
                      {categoryEmojiByName?.[cat] ? `${categoryEmojiByName[cat]} ${cat}` : cat}
                    </button>
                  ))}
                </div>
              </div>
              <SpendingLedgerTable
                rows={pagedTransactions}
                displayCurrency={displayCurrency}
                categoryEmojiByName={categoryEmojiByName}
              />

              {totalPages > 1 && (
                <div className="si-pagination">
                  <span className="si-pagination-info">
                    {(ledgerPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(ledgerPage * PAGE_SIZE, ledgerFilteredTransactions.length)} of{' '}
                    {ledgerFilteredTransactions.length}
                  </span>
                  <div className="si-pagination-btns">
                    <button
                      type="button"
                      className="si-page-btn"
                      onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                      disabled={ledgerPage === 1}
                    >
                      ← Prev
                    </button>
                    <button
                      type="button"
                      className="si-page-btn"
                      onClick={() => setLedgerPage((p) => Math.min(totalPages, p + 1))}
                      disabled={ledgerPage === totalPages}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
