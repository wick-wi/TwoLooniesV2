import React, { useMemo } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';

const CATEGORY_PALETTE = [
  '#22c55e',
  '#0ea5e9',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#eab308',
  '#ec4899',
  '#6366f1',
  '#facc15',
  '#fb7185',
];

const NODE_COLORS = {
  income: '#22c55e',
  expenses: '#f59e0b',
  savings: '#0ea5e9',
  credit_utilized: '#94a3b8',
};

function sanitizeId(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function buildCashflowSankeyData({
  income,
  expenses,
  savingsFlow,
  creditDeficitFlow,
  sankeyMode,
  categoryBreakdowns,
}) {
  const safeIncome = Number(income) || 0;
  const safeExpenses = Number(expenses) || 0;
  const safeSavingsFlow = Number(savingsFlow) || 0;
  const safeCreditDeficitFlow = Number(creditDeficitFlow) || 0;

  const isZeroIncome = safeIncome === 0 && safeExpenses > 0;
  const hasExpenses = safeExpenses > 0;

  const expenseCategories = (categoryBreakdowns || []).filter((c) => c.amount < 0);

  if (!hasExpenses || expenseCategories.length === 0) {
    return { nodes: [], links: [], colorMap: {} };
  }

  const nodes = [];
  const links = [];
  const colorMap = { ...NODE_COLORS };

  const addNode = (id, label) => {
    if (!nodes.find((n) => n.id === id)) {
      nodes.push({ id, label });
    }
  };

  const addLink = (source, target, value) => {
    const v = Number(value) || 0;
    if (v <= 0) return;
    links.push({ source, target, value: v });
  };

  if (!isZeroIncome) {
    addNode('income', 'Income');
  }

  addNode('expenses', 'Expenses');

  const needsSavingsNode = !isZeroIncome && sankeyMode === 'surplus' && safeSavingsFlow > 0;
  const needsCreditNode =
    (sankeyMode === 'deficit' && safeCreditDeficitFlow > 0) || isZeroIncome;

  if (needsSavingsNode) {
    addNode('savings', 'Savings');
  }

  if (needsCreditNode) {
    addNode('credit_utilized', 'Credit Utilized');
  }

  expenseCategories.forEach((item, index) => {
    const label = item.category || `Category ${index + 1}`;
    const id = sanitizeId(label);
    colorMap[id] = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
    addNode(id, label);
  });

  if (!isZeroIncome) {
    if (sankeyMode === 'surplus') {
      addLink('income', 'expenses', safeExpenses);
      if (needsSavingsNode) {
        addLink('income', 'savings', safeSavingsFlow);
      }
    } else {
      addLink('income', 'expenses', Math.min(safeIncome, safeExpenses));
    }
  }

  if (needsCreditNode) {
    if (isZeroIncome) {
      addLink('credit_utilized', 'expenses', safeExpenses);
    } else {
      addLink('credit_utilized', 'expenses', safeCreditDeficitFlow);
    }
  }

  expenseCategories.forEach((item, index) => {
    const label = item.category || `Category ${index + 1}`;
    const id = sanitizeId(label);
    const value = Math.abs(Number(item.amount) || 0);
    if (value > 0) {
      addLink('expenses', id, value);
    }
  });

  return { nodes, links, colorMap };
}

export default function CashflowSankey({
  income,
  expenses,
  savings,
  savingsFlow,
  creditDeficitFlow,
  sankeyMode,
  categoryBreakdowns,
  formatCurrency,
  height = 500,
}) {
  const { nodes, links, colorMap } = useMemo(
    () =>
      buildCashflowSankeyData({
        income,
        expenses,
        savingsFlow,
        creditDeficitFlow,
        sankeyMode,
        categoryBreakdowns,
      }),
    [income, expenses, savingsFlow, creditDeficitFlow, sankeyMode, categoryBreakdowns]
  );

  const hasData = nodes.length > 0 && links.length > 0;

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full text-slate-500 text-sm">
        <p className="mb-1">Not enough data to draw cash flow flows yet.</p>
        <p className="opacity-75">Try expanding your date range or including more accounts.</p>
      </div>
    );
  }

  const theme = {
    background: 'transparent',
    textColor: '#cbd5e1',
    fontSize: 13,
    labels: {
      text: {
        fontSize: 13,
        fill: '#cbd5e1',
        fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
      },
    },
    tooltip: {
      container: {
        background: '#1e293b',
        color: '#e2e8f0',
        fontSize: 13,
        borderRadius: 8,
        boxShadow: '0 10px 40px rgba(15,23,42,0.7)',
        padding: '8px 10px',
      },
    },
  };

  const formatAmount = (value) => {
    if (typeof formatCurrency === 'function') {
      return formatCurrency(value);
    }
    try {
      return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
        minimumFractionDigits: 0,
      }).format(value);
    } catch {
      return String(value);
    }
  };

  const nodeTooltip = ({ node }) => (
    <div>
      <div className="font-medium mb-1">{node.label}</div>
      <div className="text-xs text-slate-300">
        Total: {formatAmount(node.value || 0)}
      </div>
    </div>
  );

  const linkTooltip = ({ link }) => (
    <div>
      <div className="font-medium mb-1">
        {link.source.label} &rarr; {link.target.label}
      </div>
      <div className="text-xs text-slate-300">
        Flow: {formatAmount(link.value || 0)}
      </div>
    </div>
  );

  return (
    <div style={{ width: '100%', height, minHeight: height }}>
      <ResponsiveSankey
        data={{ nodes, links }}
        margin={{ top: 24, right: 180, bottom: 24, left: 180 }}
        align="justify"
        colors={(node) => colorMap[node.id] || '#64748b'}
        nodeOpacity={0.8}
        nodeHoverOthersOpacity={0.1}
        nodeThickness={14}
        nodePadding={18}
        sort="input"
        linkOpacity={0.75}
        linkBlendMode="normal"
        linkHoverOthersOpacity={0.1}
        enableLinkGradient={true}
        label={(node) => node.label || node.id}
        labelPosition="outside"
        labelOrientation="horizontal"
        labelPadding={12}
        theme={theme}
        nodeTooltip={nodeTooltip}
        linkTooltip={linkTooltip}
      />
    </div>
  );
}
