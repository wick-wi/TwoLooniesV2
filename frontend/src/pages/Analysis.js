import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAnalysis } from '../context/AnalysisContext';
import { useAuth } from '../context/AuthContext';
import SignUpModal from '../components/SignUpModal';
import './Analysis.css';

export default function Analysis() {
  const navigate = useNavigate();
  const { analysis, source } = useAnalysis();
  const { isAuthenticated } = useAuth();
  const [showSignUp, setShowSignUp] = useState(false);

  if (!analysis) {
    return (
      <div className="analysis-page">
        <p>No analysis data. <button onClick={() => navigate('/')}>Go back</button></p>
      </div>
    );
  }

  const {
    total_income,
    total_expenses,
    cash_flow,
    by_category,
    top_merchants,
    cash_flow_by_month,
  } = analysis;

  const categoryEntries = Object.entries(by_category || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const monthEntries = Object.entries(cash_flow_by_month || {});

  return (
    <div className="analysis-page">
      <header className="analysis-header">
        <div className="analysis-header-row">
          <div>
            <h1>Your Financial Insights</h1>
            <p className="source-badge">From {source === 'plaid' ? 'connected bank' : 'uploaded statement'}</p>
          </div>
          {isAuthenticated && (
            <button onClick={() => navigate('/dashboard')} className="btn-dashboard-link">
              View Dashboard
            </button>
          )}
        </div>
      </header>

      <section className="summary-cards">
        <div className="card">
          <h3>Income</h3>
          <p className="amount positive">${total_income?.toLocaleString() ?? 0}</p>
        </div>
        <div className="card">
          <h3>Expenses</h3>
          <p className="amount negative">${total_expenses?.toLocaleString() ?? 0}</p>
        </div>
        <div className="card">
          <h3>Cash Flow</h3>
          <p className={`amount ${cash_flow >= 0 ? 'positive' : 'negative'}`}>
            ${cash_flow?.toLocaleString() ?? 0}
          </p>
        </div>
      </section>

      <section className="insight-section">
        <h2>Spending by Category</h2>
        {categoryEntries.length > 0 ? (
          <ul className="category-list">
            {categoryEntries.slice(0, 10).map(([cat, amt]) => (
              <li key={cat}>
                <span className="cat-name">{cat}</span>
                <span className="cat-amount">${Math.abs(amt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No category data available.</p>
        )}
      </section>

      <section className="insight-section">
        <h2>Top Merchants</h2>
        {(top_merchants?.length ?? 0) > 0 ? (
          <ul className="merchant-list">
            {top_merchants.map((m, i) => (
              <li key={i}>
                <span className="merchant-name">{m.name}</span>
                <span className="merchant-amount">${m.amount?.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No merchant data available.</p>
        )}
      </section>

      {monthEntries.length > 0 && (
        <section className="insight-section">
          <h2>Cash Flow by Month</h2>
          <ul className="month-list">
            {monthEntries.map(([month, amt]) => (
              <li key={month}>
                <span className="month-name">{month}</span>
                <span className={`month-amount ${amt >= 0 ? 'positive' : 'negative'}`}>
                  ${amt?.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cta-section">
        <p>Save this analysis and unlock more features.</p>
        <button className="btn-save" onClick={() => setShowSignUp(true)}>
          Save & Create Account
        </button>
      </section>

      {showSignUp && (
        <SignUpModal
          onClose={() => setShowSignUp(false)}
          onSuccess={() => {
            setShowSignUp(false);
            navigate('/');
          }}
        />
      )}
    </div>
  );
}
