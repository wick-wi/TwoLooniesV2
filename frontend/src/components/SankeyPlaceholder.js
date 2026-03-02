import React from 'react';
import './SankeyPlaceholder.css';

/**
 * A simple SVG placeholder depicting Income → Expenses → Savings flow.
 * Uses theme's amber and slate colors for premium feel.
 */
export default function SankeyPlaceholder() {
  return (
    <div className="sankey-placeholder">
      <svg
        viewBox="0 0 400 120"
        className="sankey-placeholder-svg"
        aria-hidden
      >
        {/* Income node */}
        <rect x="20" y="40" width="80" height="40" rx="6" className="sankey-node sankey-income" />
        <text x="60" y="65" textAnchor="middle" className="sankey-label">Income</text>

        {/* Flow path 1: Income → Expenses (larger band) */}
        <path
          d="M 100 45 L 300 25 L 320 40 L 300 55 L 100 65 Z"
          className="sankey-flow sankey-flow-1"
        />

        {/* Flow path 2: Income → Savings (smaller band) */}
        <path
          d="M 100 70 L 300 80 L 320 95 L 300 85 L 100 75 Z"
          className="sankey-flow sankey-flow-2"
        />

        {/* Expenses node */}
        <rect x="320" y="20" width="60" height="35" rx="6" className="sankey-node sankey-expenses" />
        <text x="350" y="42" textAnchor="middle" className="sankey-label">Expenses</text>

        {/* Savings node */}
        <rect x="320" y="70" width="60" height="35" rx="6" className="sankey-node sankey-savings" />
        <text x="350" y="92" textAnchor="middle" className="sankey-label">Savings</text>

        {/* Flow arrows */}
        <path d="M 200 50 L 210 50" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
        <path d="M 200 72 L 210 72" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
      </svg>
      <p className="sankey-placeholder-label">Income vs Expenses Flow</p>
      <p className="sankey-placeholder-hint">Coming soon — Full Sankey diagram</p>
    </div>
  );
}
