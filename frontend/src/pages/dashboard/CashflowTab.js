import React from 'react';
import SankeyPlaceholder from '../../components/SankeyPlaceholder';
import { mockData } from '../../data/mockData';
import './CashflowTab.css';

export default function CashflowTab() {
  const { categoryBreakdowns } = mockData;

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(value);

  return (
    <div className="cashflow-tab">
      {/* Sankey Placeholder */}
      <section className="cashflow-tab-section">
        <h2 className="cashflow-tab-section-title">Cash Flow</h2>
        <div className="glass-card cashflow-tab-sankey-wrapper">
          <SankeyPlaceholder />
        </div>
      </section>

      {/* Category Breakdowns */}
      <section className="cashflow-tab-section">
        <h2 className="cashflow-tab-section-title">Category Breakdown</h2>
        <div className="glass-card cashflow-tab-list">
          {categoryBreakdowns.map((item, i) => (
            <div key={i} className="cashflow-tab-item">
              <span className="cashflow-tab-category">{item.category}</span>
              <span className="cashflow-tab-amount">{formatCurrency(item.amount)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
