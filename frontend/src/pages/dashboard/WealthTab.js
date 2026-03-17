import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Wallet, TrendingUp, PiggyBank, Target, Clock, CreditCard, ChevronRight } from 'lucide-react';
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
      const displayBalance = isLiability && balance > 0 ? -balance : balance;
      groups[groupKey].push({
        id: `${a.id}-${b.currency}`,
        accountId: a.id,
        provider: displayName,
        type: subtype,
        balance: displayBalance,
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

  const groups = groupAccounts(accounts);

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
      {WEALTH_SECTIONS.map(({ key, title, icon: Icon, description }) => {
        const items = groups[key] || [];
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
              {items.length === 0 ? (
                <div className="wealth-tab-empty">No accounts in this category</div>
              ) : (
                items.map((item) => {
                  const isInvestment = item.accountType === 'investment';
                  const isExpanded = expandedItemId === item.id;
                  const cached = holdingsByKey[item.id];
                  return (
                    <div
                      key={item.id}
                      className={`wealth-tab-item ${isInvestment ? 'wealth-tab-item-expandable' : ''} ${isExpanded ? 'wealth-tab-item-expanded' : ''}`}
                      onClick={isInvestment ? () => toggleExpand(item) : undefined}
                      role={isInvestment ? 'button' : undefined}
                      aria-expanded={isInvestment ? isExpanded : undefined}
                    >
                      <div className="wealth-tab-item-main">
                        <span className="wealth-tab-provider">
                          {isInvestment && (
                            <ChevronRight className="wealth-tab-expand-icon" strokeWidth={2} aria-hidden />
                          )}
                          {item.type && <span className="wealth-tab-type">{item.type}</span>}
                          {item.type && item.provider ? ' · ' : ''}
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
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
