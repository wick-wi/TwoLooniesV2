import React from 'react';
import { Wallet, PiggyBank, CreditCard } from 'lucide-react';
import { mockData } from '../../data/mockData';
import './WealthTab.css';

export default function WealthTab() {
  const { liquid, taxAdvantaged, liabilities } = mockData;

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(value);

  return (
    <div className="wealth-tab">
      {/* Liquid */}
      <section className="wealth-tab-section">
        <h2 className="wealth-tab-group-title">
          <Wallet className="wealth-tab-group-icon" strokeWidth={1.5} />
          Liquid
        </h2>
        <div className="glass-card wealth-tab-list">
          {liquid.map((item, i) => (
            <div key={i} className="wealth-tab-item">
              <span className="wealth-tab-provider">{item.provider}</span>
              <span className="wealth-tab-balance wealth-tab-balance-positive">
                {formatCurrency(item.balance)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Tax-Advantaged */}
      <section className="wealth-tab-section">
        <h2 className="wealth-tab-group-title">
          <PiggyBank className="wealth-tab-group-icon" strokeWidth={1.5} />
          Tax-Advantaged
        </h2>
        <div className="glass-card wealth-tab-list">
          {taxAdvantaged.map((item, i) => (
            <div key={i} className="wealth-tab-item">
              <span className="wealth-tab-provider">
                <span className="wealth-tab-type">{item.type}</span> · {item.provider}
              </span>
              <span className="wealth-tab-balance wealth-tab-balance-positive">
                {formatCurrency(item.balance)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Liabilities */}
      <section className="wealth-tab-section">
        <h2 className="wealth-tab-group-title">
          <CreditCard className="wealth-tab-group-icon" strokeWidth={1.5} />
          Liabilities
        </h2>
        <div className="glass-card wealth-tab-list">
          {liabilities.map((item, i) => (
            <div key={i} className="wealth-tab-item">
              <span className="wealth-tab-provider">{item.provider}</span>
              <span className="wealth-tab-balance wealth-tab-balance-negative">
                {formatCurrency(item.balance)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
