import React from 'react';
import './SankeyPlaceholder.css';

/**
 * Placeholder Sankey-style diagram. Renders only non-negative flows:
 * - Surplus (income >= expenses): Income → Expenses, Income → Savings. No credit node.
 * - Deficit (expenses > income): Income → Expenses, Credit/Deficit → Expenses. No savings node.
 * - Break-even: Income → Expenses only.
 */
export default function SankeyPlaceholder({
  mode = 'surplus',
  income,
  expenses,
  savings,
  savingsFlow = 0,
  creditDeficitFlow = 0,
  sankeySourceLabel = 'Income',
}) {
  const isSurplus = mode === 'surplus';
  const isDeficit = mode === 'deficit';
  const hasSavings = isSurplus && typeof savingsFlow === 'number' && savingsFlow > 0;
  const hasCredit = isDeficit && typeof creditDeficitFlow === 'number' && creditDeficitFlow > 0;

  return (
    <div className="sankey-placeholder">
      <svg
        viewBox="0 0 400 120"
        className="sankey-placeholder-svg"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        {isSurplus && (
          <>
            {/* Income node */}
            <rect x="20" y="40" width="80" height="40" rx="6" className="sankey-node sankey-income" />
            <text x="60" y="65" textAnchor="middle" className="sankey-label">
              {sankeySourceLabel}
            </text>

            {/* Flow 1: Income → Expenses */}
            <path
              d="M 100 45 L 300 25 L 320 40 L 300 55 L 100 65 Z"
              className="sankey-flow sankey-flow-1"
            />

            {hasSavings ? (
              <>
                {/* Flow 2: Income → Savings */}
                <path
                  d="M 100 70 L 300 80 L 320 95 L 300 85 L 100 75 Z"
                  className="sankey-flow sankey-flow-2"
                />
                {/* Expenses node */}
                <rect x="320" y="20" width="60" height="35" rx="6" className="sankey-node sankey-expenses" />
                <text x="350" y="42" textAnchor="middle" className="sankey-label">
                  Expenses
                </text>
                {/* Savings node */}
                <rect x="320" y="70" width="60" height="35" rx="6" className="sankey-node sankey-savings" />
                <text x="350" y="92" textAnchor="middle" className="sankey-label">
                  Savings
                </text>
                <path d="M 200 50 L 210 50" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
                <path d="M 200 72 L 210 72" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
              </>
            ) : (
              <>
                {/* Break-even: single Expenses node */}
                <rect x="320" y="40" width="60" height="40" rx="6" className="sankey-node sankey-expenses" />
                <text x="350" y="65" textAnchor="middle" className="sankey-label">
                  Expenses
                </text>
                <path d="M 200 60 L 210 60" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
              </>
            )}
          </>
        )}

        {isDeficit && (
          <>
            {/* Income node (top left) */}
            <rect x="20" y="15" width="80" height="35" rx="6" className="sankey-node sankey-income" />
            <text x="60" y="36" textAnchor="middle" className="sankey-label">
              Income
            </text>
            {/* Single Credit / Deficit node (bottom left) */}
            <rect x="20" y="65" width="80" height="35" rx="6" className="sankey-node sankey-credit" />
            <text x="60" y="86" textAnchor="middle" className="sankey-label">
              Credit / Deficit
            </text>
            {/* Expenses node (right, centered) */}
            <rect x="320" y="25" width="60" height="70" rx="6" className="sankey-node sankey-expenses" />
            <text x="350" y="62" textAnchor="middle" className="sankey-label">
              Expenses
            </text>
            {/* Flow 1: Income → Expenses */}
            <path
              d="M 100 28 L 280 35 L 320 50 L 280 45 L 100 38 Z"
              className="sankey-flow sankey-flow-1"
            />
            {/* Flow 2: Credit / Deficit → Expenses */}
            <path
              d="M 100 78 L 280 85 L 320 90 L 280 75 L 100 82 Z"
              className="sankey-flow sankey-flow-credit"
            />
            <path d="M 190 40 L 200 40" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
            <path d="M 190 82 L 200 82" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
          </>
        )}
      </svg>
      <p className="sankey-placeholder-hint">Coming soon — Full Sankey diagram</p>
    </div>
  );
}
