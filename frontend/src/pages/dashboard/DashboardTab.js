import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { mockData } from '../../data/mockData';
import './DashboardTab.css';

export default function DashboardTab() {
  const {
    netWorth,
    runwayMonths,
    runwayLabel,
    personalInflation,
    inflationTrend,
    profileCompletionPercent,
    profileCompletionLabel,
    aiInsights,
  } = mockData;

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(value);

  return (
    <div className="dashboard-tab">
      {/* Nudge Section */}
      <section className="glass-card dashboard-tab-nudge">
        <p className="dashboard-tab-nudge-label">{profileCompletionLabel}.</p>
        <div className="dashboard-tab-progress-track">
          <div
            className="dashboard-tab-progress-fill"
            style={{ width: `${profileCompletionPercent}%` }}
            role="progressbar"
            aria-valuenow={profileCompletionPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <span className="dashboard-tab-progress-value">{profileCompletionPercent}%</span>
      </section>

      {/* Hero Metric Cards */}
      <section className="dashboard-tab-hero-grid">
        <div className="glass-card dashboard-tab-hero-card">
          <h3 className="dashboard-tab-hero-label">Net Worth</h3>
          <p className="dashboard-tab-hero-value">{formatCurrency(netWorth.current)}</p>
          <span className="dashboard-tab-badge">{netWorth.cohort.label}</span>
        </div>

        <div className="glass-card dashboard-tab-hero-card">
          <h3 className="dashboard-tab-hero-label">{runwayLabel}</h3>
          <p className="dashboard-tab-hero-value dashboard-tab-hero-runway">{runwayMonths} Months</p>
        </div>

        <div className="glass-card dashboard-tab-hero-card">
          <h3 className="dashboard-tab-hero-label">Personal Inflation</h3>
          <div className="dashboard-tab-inflation-row">
            <p className="dashboard-tab-hero-value dashboard-tab-hero-inflation">
              +{personalInflation}% YoY
            </p>
            {inflationTrend === 'up' ? (
              <TrendingUp className="dashboard-tab-trend-icon dashboard-tab-trend-up" aria-hidden />
            ) : (
              <TrendingDown className="dashboard-tab-trend-icon dashboard-tab-trend-down" aria-hidden />
            )}
          </div>
        </div>
      </section>

      {/* AI Insights */}
      <section className="dashboard-tab-insights">
        <h2 className="dashboard-tab-section-title">AI Insights</h2>
        <div className="dashboard-tab-insights-grid">
          {aiInsights.map((tip, i) => (
            <div key={i} className="glass-card dashboard-tab-insight-card">
              <p className="dashboard-tab-insight-text">{tip}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
