import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Wallet, TrendingUp, PiggyBank, Target, Clock, CreditCard } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
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
    const wealthType = WEALTH_TYPE_BY_ACCOUNT[a.account_type];
    const groupKey = wealthType ? keyByWealthType[wealthType] : null;
    if (!groupKey) continue;
    const balance = Number(a.last_balance ?? 0);
    const displayName = a.name?.trim() || [a.provider, a.account_type].filter(Boolean).join(' ') || 'Account';
    const isLiability = wealthType === 'Liability';
    const displayBalance = isLiability && balance > 0 ? -balance : balance;
    groups[groupKey].push({
      id: a.id,
      provider: displayName,
      type: a.account_type,
      balance: displayBalance,
      isLiability,
    });
  }
  return groups;
}

export default function WealthTab() {
  const { user, getAccessToken } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAccounts = useCallback(async () => {
    if (!user?.id || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Refresh balances from statements/transactions so Cash etc. show correct totals
      if (API_BASE && getAccessToken) {
        try {
          await axios.post(
            `${API_BASE}/api/refresh_account_balances`,
            {},
            { headers: { Authorization: `Bearer ${getAccessToken()}` } }
          );
        } catch (_) {
          // ignore; will show whatever last_balance is in DB
        }
      }
      const { data, error: fetchError } = await supabase
        .from('accounts')
        .select('id, name, account_type, provider, last_balance')
        .eq('user_id', user.id)
        .order('account_type');
      if (fetchError) throw fetchError;
      setAccounts(data || []);
    } catch (e) {
      console.error('Wealth tab fetch error:', e);
      setError(e.message || 'Failed to load accounts.');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, getAccessToken]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(value);

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
                items.map((item) => (
                  <div key={item.id} className="wealth-tab-item">
                    <span className="wealth-tab-provider">
                      {item.type && <span className="wealth-tab-type">{item.type}</span>}
                      {item.type && item.provider ? ' · ' : ''}
                      {item.provider}
                    </span>
                    <span className={`wealth-tab-balance ${item.isLiability ? 'wealth-tab-balance-negative' : 'wealth-tab-balance-positive'}`}>
                      {formatCurrency(item.balance)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
