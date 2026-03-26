import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Wallet, TrendingUp, PiggyBank, Target, Clock, CreditCard, ChevronRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/money';
import './WealthTab.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

// Mirrors api/data/account_types.json wealth_type categorisation
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

const WEALTH_SECTIONS = [
  { key: 'liquidCash', title: 'Liquid Cash', icon: Wallet, description: 'Chequing, Savings, etc.' },
  { key: 'liquidAsset', title: 'Liquid Assets', icon: TrendingUp, description: 'Crypto, Margin, etc.' },
  { key: 'retirementLocked', title: 'Retirement Locked', icon: PiggyBank, description: 'RRSP, LIRA, etc.' },
  { key: 'purposeLocked', title: 'Purpose Locked', icon: Target, description: 'FHSA, RESP, RDSP, etc.' },
  { key: 'timeLocked', title: 'Time Locked', icon: Clock, description: 'GIC, etc.' },
  { key: 'liabilities', title: 'Liabilities', icon: CreditCard, description: 'Credit cards, loans, mortgages, etc.' },
];

function groupAccounts(accounts) {
  const groups = {
    liquidCash: [],
    liquidAsset: [],
    retirementLocked: [],
    purposeLocked: [],
    timeLocked: [],
    liabilities: [],
  };
  const keyByWealthType = {
    'Liquid Cash': 'liquidCash',
    'Liquid Asset': 'liquidAsset',
    'Retirement Locked': 'retirementLocked',
    'Purpose Locked': 'purposeLocked',
    'Time Locked': 'timeLocked',
    Liability: 'liabilities',
  };
  for (const a of accounts || []) {
    const subtype = a.account_subtype || a.account_type;
    const wealthType = WEALTH_TYPE_BY_ACCOUNT[subtype] || 'Liquid Asset'; // fallback so accounts with balances still show
    const groupKey = keyByWealthType[wealthType];
    if (!groupKey) continue;
    const displayName = a.name?.trim() || [a.provider, subtype].filter(Boolean).join(' ') || 'Account';
    const isLiability = wealthType === 'Liability';
    const balances = Array.isArray(a.balances) && a.balances.length > 0
      ? a.balances
      : [{ amount: 0, currency: 'CAD', date: null }];
    for (const b of balances) {
      const balance = Number(b.amount ?? 0);
      groups[groupKey].push({
        id: `${a.id}-${b.currency}`,
        accountId: a.id,
        provider: displayName,
        type: subtype,
        balance,
        currency: b.currency || 'CAD',
        date: b.date ?? null,
        isLiability,
        accountType: a.account_type,
      });
    }
  }
  return groups;
}

export default function WealthTab() {
  const { user, getAccessToken } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exchangeRatesToCad, setExchangeRatesToCad] = useState({ CAD: 1 });
  const [baseCurrency, setBaseCurrency] = useState('CAD');
  const [expandedSubtypeByKey, setExpandedSubtypeByKey] = useState({});
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [holdingsByKey, setHoldingsByKey] = useState({});

  const fetchAccounts = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    if (!API_BASE || !getAccessToken) {
      setLoading(false);
      setAccounts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/accounts_with_balances`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      setAccounts(res.data?.accounts ?? []);
    } catch (e) {
      console.error('Wealth tab fetch error:', e);
      setError(e.response?.data?.detail || e.message || 'Failed to load accounts.');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, getAccessToken]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    let active = true;
    const fetchExchangeRates = async () => {
      if (!API_BASE) return;
      try {
        const res = await axios.get(`${API_BASE}/api/exchange_rates`);
        const toCad = res.data?.to_cad;
        if (active && toCad && typeof toCad === 'object') {
          setExchangeRatesToCad({ CAD: 1, ...toCad });
        }
      } catch (e) {
        console.warn('Failed to load exchange rates. Falling back to CAD-only.', e);
      }
    };
    fetchExchangeRates();
    return () => {
      active = false;
    };
  }, []);

  const fetchHoldings = useCallback(async (itemId, accountId, currency) => {
    let alreadyExists = false;
    setHoldingsByKey((prev) => {
      if (prev[itemId] !== undefined) { alreadyExists = true; return prev; }
      return { ...prev, [itemId]: { loading: true } };
    });
    if (alreadyExists) return;
    try {
      const res = await axios.get(`${API_BASE}/api/holdings`, {
        params: { account_id: accountId, currency: currency || 'CAD' },
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      setHoldingsByKey((prev) => ({
        ...prev,
        [itemId]: { date: res.data?.date ?? null, holdings: res.data?.holdings ?? [] },
      }));
    } catch (e) {
      setHoldingsByKey((prev) => ({
        ...prev,
        [itemId]: { error: e.response?.data?.detail || e.message || 'Failed to load holdings.' },
      }));
    }
  }, [getAccessToken]);

  const toggleExpand = useCallback((item) => {
    if (item.accountType !== 'investment') return;
    const id = item.id;
    const isExpanding = expandedItemId !== id;
    setExpandedItemId((prev) => (prev === id ? null : id));
    if (isExpanding && holdingsByKey[id] === undefined) {
      fetchHoldings(id, item.accountId, item.currency);
    }
  }, [expandedItemId, holdingsByKey, fetchHoldings]);

  const convertAmount = useCallback((amount, fromCurrency, toCurrency) => {
    const from = (fromCurrency || 'CAD').toUpperCase();
    const to = (toCurrency || 'CAD').toUpperCase();
    const value = Number(amount ?? 0);
    if (!Number.isFinite(value)) return 0;
    if (from === to) return value;
    const fromToCad = Number(exchangeRatesToCad[from]);
    const toToCad = Number(exchangeRatesToCad[to]);
    if (!Number.isFinite(fromToCad) || !Number.isFinite(toToCad) || toToCad === 0) {
      return 0;
    }
    const cadValue = value * fromToCad;
    return cadValue / toToCad;
  }, [exchangeRatesToCad]);

  const formatCurrency = (value, currency = 'CAD') =>
    formatMoney(value, currency, { minimumFractionDigits: 0 });

  const formatBalanceDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return null;
    }
  };

  const monthYearKey = useCallback((dateStr) => {
    if (!dateStr) return null;
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return null;
    return `${parsed.getUTCFullYear()}-${parsed.getUTCMonth() + 1}`;
  }, []);

  const groups = useMemo(() => groupAccounts(accounts), [accounts]);
  const supportedCurrencies = useMemo(
    () => Object.keys(exchangeRatesToCad || {}).sort((a, b) => a.localeCompare(b)),
    [exchangeRatesToCad]
  );

  const wealthHierarchy = useMemo(() => {
    const hasSignificantBalance = (item) =>
      Math.abs(convertAmount(item.balance, item.currency, baseCurrency)) >= 1;

    return WEALTH_SECTIONS.map((section) => {
      const sectionItems = groups[section.key] || [];
      const subtypeMap = new Map();
      const sectionMonthYears = new Set();
      let sectionHasMissingOrInvalidDate = false;
      let sectionHasSignificantAccount = false;
      let sectionTotal = 0;

      sectionItems.forEach((item) => {
        const subtype = item.type || 'Uncategorized';
        const convertedBalance = convertAmount(item.balance, item.currency, baseCurrency);
        const significantForWarning = hasSignificantBalance(item);
        sectionTotal += convertedBalance;
        const monthBucket = significantForWarning ? monthYearKey(item.date) : null;
        if (significantForWarning) {
          sectionHasSignificantAccount = true;
          if (monthBucket) {
            sectionMonthYears.add(monthBucket);
          } else {
            sectionHasMissingOrInvalidDate = true;
          }
        }

        if (!subtypeMap.has(subtype)) {
          subtypeMap.set(subtype, {
            key: `${section.key}::${subtype}`,
            subtype,
            total: 0,
            items: [],
            monthYears: new Set(),
            hasMissingOrInvalidDate: false,
            hasSignificantAccount: false,
          });
        }
        const bucket = subtypeMap.get(subtype);
        bucket.total += convertedBalance;
        bucket.items.push(item);
        if (significantForWarning) {
          bucket.hasSignificantAccount = true;
          if (monthBucket) {
            bucket.monthYears.add(monthBucket);
          } else {
            bucket.hasMissingOrInvalidDate = true;
          }
        }
      });

      const subtypes = Array.from(subtypeMap.values())
        .map((sub) => ({
          ...sub,
          hasDateCaution: sub.hasSignificantAccount && (sub.hasMissingOrInvalidDate || sub.monthYears.size > 1),
        }))
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

      return {
        ...section,
        total: sectionTotal,
        hasDateCaution: sectionHasSignificantAccount && (sectionHasMissingOrInvalidDate || sectionMonthYears.size > 1),
        subtypes,
      };
    });
  }, [groups, convertAmount, baseCurrency, monthYearKey]);

  const netWorth = useMemo(() => {
    let totalAssets = 0;
    let liabilitiesMagnitude = 0;
    wealthHierarchy.forEach((section) => {
      if (section.key === 'liabilities') {
        liabilitiesMagnitude += Math.abs(section.total || 0);
      } else {
        totalAssets += section.total || 0;
      }
    });
    return totalAssets - liabilitiesMagnitude;
  }, [wealthHierarchy]);

  const toggleSubtype = useCallback((subtypeKey) => {
    setExpandedSubtypeByKey((prev) => ({ ...prev, [subtypeKey]: !prev[subtypeKey] }));
  }, []);

  if (loading) {
    return (
      <div className="wealth-tab">
        <div className="wealth-tab-loading">Loading accounts…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wealth-tab">
        <div className="wealth-tab-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="wealth-tab">
      <div className="wealth-tab-toolbar glass-card">
        <label htmlFor="wealth-base-currency" className="wealth-tab-toolbar-label">
          Collapse totals in
        </label>
        <select
          id="wealth-base-currency"
          className="wealth-tab-currency-select"
          value={baseCurrency}
          onChange={(e) => setBaseCurrency(e.target.value)}
        >
          {supportedCurrencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </div>

      <div className="wealth-tab-networth-row">
        <div className="glass-card wealth-tab-networth-card">
          <div className="wealth-tab-networth-header">
            <span className="wealth-tab-networth-label">Net Worth</span>
          </div>
          <span
            className={`wealth-tab-networth-value ${
              netWorth > 0
                ? 'wealth-tab-balance-positive'
                : netWorth < 0
                  ? 'wealth-tab-balance-negative'
                  : ''
            }`}
          >
            {formatCurrency(netWorth, baseCurrency)}
          </span>
          <span className="wealth-tab-networth-sub">Assets minus liabilities ({baseCurrency})</span>
        </div>
      </div>

      <div className="wealth-tab-metrics-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {wealthHierarchy.map(({ key, title, icon: Icon, total, hasDateCaution }) => (
          <div key={`metric-${key}`} className="glass-card wealth-tab-metric-card">
            <div className="wealth-tab-metric-header">
              <span className="wealth-tab-metric-label">{title}</span>
              <Icon size={16} className="wealth-tab-metric-icon" />
            </div>
            <span className={`wealth-tab-metric-value ${key === 'liabilities' ? 'wealth-tab-balance-negative' : 'wealth-tab-balance-positive'}`}>
              {formatCurrency(total, baseCurrency)}
            </span>
            {hasDateCaution && (
              <span className="wealth-tab-warning" title="Some balances in this group are from different month/year buckets.">
                <AlertTriangle className="wealth-tab-warning-icon" strokeWidth={1.8} aria-hidden />
                Mixed balance dates
              </span>
            )}
          </div>
        ))}
      </div>

      {wealthHierarchy.map(({ key, title, icon: Icon, description, subtypes }) => {
        return (
          <section key={key} className="wealth-tab-section">
            <h2 className="wealth-tab-group-title">
              <Icon className="wealth-tab-group-icon" strokeWidth={1.5} />
              {title}
            </h2>
            {description && (
              <p className="wealth-tab-group-desc">{description}</p>
            )}
            <div className="glass-card wealth-tab-list">
              {subtypes.length === 0 ? (
                <div className="wealth-tab-empty">No accounts in this category</div>
              ) : (
                <div className="wealth-tab-subtype-list">
                  {subtypes.map((subtypeGroup) => {
                    const subtypeExpanded = !!expandedSubtypeByKey[subtypeGroup.key];
                    return (
                      <div key={subtypeGroup.key} className="wealth-tab-subtype-group">
                        <button
                          type="button"
                          className={`wealth-tab-item wealth-tab-collapse-row wealth-tab-item-expandable wealth-tab-subtype-row ${subtypeExpanded ? 'wealth-tab-item-expanded' : ''}`}
                          onClick={() => toggleSubtype(subtypeGroup.key)}
                          aria-expanded={subtypeExpanded}
                        >
                          <div className="wealth-tab-item-main">
                            <span className="wealth-tab-provider">
                              <ChevronRight className="wealth-tab-expand-icon" strokeWidth={2} aria-hidden />
                              <span className="wealth-tab-type">{subtypeGroup.subtype}</span>
                            </span>
                            <span className="wealth-tab-item-right">
                              <span className={`wealth-tab-balance ${key === 'liabilities' ? 'wealth-tab-balance-negative' : 'wealth-tab-balance-positive'}`}>
                                {formatCurrency(subtypeGroup.total, baseCurrency)}
                              </span>
                              {subtypeGroup.hasDateCaution && (
                                <span className="wealth-tab-warning" title="Some balances in this subgroup are from different month/year buckets.">
                                  <AlertTriangle className="wealth-tab-warning-icon" strokeWidth={1.8} aria-hidden />
                                  Mixed balance dates
                                </span>
                              )}
                            </span>
                          </div>
                        </button>

                        {subtypeExpanded && (
                          <div className="wealth-tab-account-list">
                            {subtypeGroup.items.map((item) => {
                              const isInvestment = item.accountType === 'investment';
                              const isExpanded = expandedItemId === item.id;
                              const cached = holdingsByKey[item.id];
                              const hasSignificantBalance = Math.abs(convertAmount(item.balance, item.currency, baseCurrency)) >= 1;
                              return (
                                <div
                                  key={item.id}
                                  className={`wealth-tab-item wealth-tab-account-item ${isInvestment ? 'wealth-tab-item-expandable' : ''} ${isExpanded ? 'wealth-tab-item-expanded' : ''}`}
                                  onClick={isInvestment ? () => toggleExpand(item) : undefined}
                                  role={isInvestment ? 'button' : undefined}
                                  aria-expanded={isInvestment ? isExpanded : undefined}
                                >
                                  <div className="wealth-tab-item-main">
                                    <span className="wealth-tab-provider">
                                      {isInvestment && (
                                        <ChevronRight className="wealth-tab-expand-icon" strokeWidth={2} aria-hidden />
                                      )}
                                      {item.provider}
                                    </span>
                                    <span className="wealth-tab-item-right">
                                      <span className={`wealth-tab-balance ${item.isLiability ? 'wealth-tab-balance-negative' : 'wealth-tab-balance-positive'}`}>
                                        {formatCurrency(item.balance, item.currency)}
                                      </span>
                                      {formatBalanceDate(item.date) && (
                                        <span className="wealth-tab-balance-date">
                                          Balance as of {formatBalanceDate(item.date)}
                                        </span>
                                      )}
                                      {!hasSignificantBalance && (
                                        <span className="wealth-tab-insignificant-note">
                                          No significant balance in account
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                  {isInvestment && isExpanded && (
                                    <div className="wealth-tab-holdings">
                                      {(cached === undefined || cached?.loading) && (
                                        <div className="wealth-tab-holdings-loading">Loading holdings…</div>
                                      )}
                                      {cached?.error && (
                                        <div className="wealth-tab-holdings-error">{cached.error}</div>
                                      )}
                                      {cached?.holdings && !cached.loading && !cached.error && (
                                        <>
                                          {cached.date && (
                                            <div className="wealth-tab-holdings-date">
                                              Holdings as of {formatBalanceDate(cached.date)}
                                            </div>
                                          )}
                                          {cached.holdings.length === 0 ? (
                                            <div className="wealth-tab-holdings-empty">No holdings for this account/currency.</div>
                                          ) : (
                                            <div className="wealth-tab-holdings-list">
                                              {cached.holdings.map((h, idx) => (
                                                <div key={idx} className="wealth-tab-holding-row">
                                                  <span className="wealth-tab-holding-symbol">
                                                    {h.asset_symbol || '—'}
                                                    {h.asset_name ? ` · ${h.asset_name}` : ''}
                                                  </span>
                                                  <span className="wealth-tab-holding-detail">
                                                    {h.quantity != null && h.unit_price != null && (
                                                      <span className="wealth-tab-holding-qty">
                                                        {Number(h.quantity).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 6 })} × {formatCurrency(h.unit_price, h.currency)}
                                                      </span>
                                                    )}
                                                    <span className={`wealth-tab-holding-value ${item.isLiability ? 'wealth-tab-balance-negative' : 'wealth-tab-balance-positive'}`}>
                                                      {formatCurrency(h.total_value ?? 0, h.currency || item.currency)}
                                                    </span>
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
