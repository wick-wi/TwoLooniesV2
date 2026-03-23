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
  spending: '#f59e0b',
  investments: '#a855f7',
  transfers_out: '#38bdf8',
  uncategorized_out: '#94a3b8',
  savings: '#0ea5e9',
  credit_utilized: '#94a3b8',
  cash_deployed: '#34d399',
  overdraft: '#f97316',
  margin: '#c084fc',
  inflow: '#22c55e',
};

function sanitizeId(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Split `amount` across positive weights; returns same length as weights. */
function proportionalSplitN(amount, weights) {
  const n = weights.length;
  const out = Array(n).fill(0);
  const t = weights.reduce((acc, w) => acc + (Number(w) || 0), 0);
  if (amount <= 0 || t <= 0) return out;
  for (let i = 0; i < n; i++) {
    const w = Number(weights[i]) || 0;
    out[i] = Math.round(((amount * w) / t) * 100) / 100;
  }
  const diff = Math.round((amount - out.reduce((a, b) => a + b, 0)) * 100) / 100;
  if (diff !== 0) {
    let maxI = 0;
    for (let i = 1; i < n; i++) {
      if ((Number(weights[i]) || 0) > (Number(weights[maxI]) || 0)) maxI = i;
    }
    out[maxI] = Math.round((out[maxI] + diff) * 100) / 100;
  }
  return out;
}

/**
 * @param {Array<{ id: string, label: string, value: number }>} sourceSlices
 */
function buildCashflowSankeyData({
  spendingTotal,
  investmentOutTotal,
  transfersOutTotal,
  uncategorizedOutTotal,
  transfersOutSelf,
  transfersOutEtransfer,
  savingsFlow,
  sankeyMode,
  spendingCategoryBreakdowns,
  sourceSlices,
}) {
  const safeSpending = Number(spendingTotal) || 0;
  const safeInvest = Number(investmentOutTotal) || 0;
  const safeTransfers = Number(transfersOutTotal) || 0;
  const safeUncategorized = Number(uncategorizedOutTotal) || 0;
  const safeSelf = Number(transfersOutSelf) || 0;
  const safeEtrf = Number(transfersOutEtransfer) || 0;
  const safeSavingsFlow = Number(savingsFlow) || 0;

  const totalOut = safeSpending + safeInvest + safeTransfers + safeUncategorized;
  const sources = (sourceSlices || []).filter((s) => (Number(s.value) || 0) > 0.01);
  const totalSources = sources.reduce((acc, s) => acc + (Number(s.value) || 0), 0);

  const hasOutflows = totalOut > 0;
  const spendingCats = (spendingCategoryBreakdowns || []).filter((c) => c.amount < 0);
  const useSyntheticSpending = safeSpending > 0 && spendingCats.length === 0;

  if (!hasOutflows || totalSources <= 0.01) {
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

  const needsSavingsNode = sankeyMode === 'surplus' && safeSavingsFlow > 0;
  const wSave = needsSavingsNode ? safeSavingsFlow : 0;

  sources.forEach((s, i) => {
    const id = s.id || `src_${i}`;
    colorMap[id] = s.isCredit
      ? NODE_COLORS.credit_utilized
      : s.isMargin
        ? NODE_COLORS.margin
        : s.isOverdraft
          ? NODE_COLORS.overdraft
          : s.isCash
            ? NODE_COLORS.cash_deployed
            : CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
    addNode(id, s.label || `Source ${i + 1}`);
  });

  if (safeSpending > 0) addNode('spending', 'Spending');
  if (safeInvest > 0) addNode('investments', 'Investments');
  if (safeTransfers > 0) {
    colorMap.transfers_out = NODE_COLORS.transfers_out;
    addNode('transfers_out', 'Transfers out');
  }
  if (safeUncategorized > 0) {
    colorMap.uncategorized_out = NODE_COLORS.uncategorized_out;
    addNode('uncategorized_out', 'Uncategorized out');
  }
  if (needsSavingsNode) addNode('savings', 'Savings');

  if (useSyntheticSpending) {
    const oid = 'cashflow_spending_other';
    colorMap[oid] = CATEGORY_PALETTE[0];
    addNode(oid, 'Other spending');
  } else {
    spendingCats.forEach((item, index) => {
      const label = item.category || `Category ${index + 1}`;
      const id = sanitizeId(label);
      colorMap[id] = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
      addNode(id, label);
    });
  }

  if (safeInvest > 0) {
    const invLeafId = sanitizeId('Securities Trading');
    colorMap[invLeafId] = NODE_COLORS.investments;
    addNode(invLeafId, 'Securities Trading');
  }

  const transferLeafSelf = sanitizeId('Self-Transfer');
  const transferLeafEtrf = sanitizeId('E-Transfer');
  if (safeTransfers > 0) {
    if (safeSelf > 0.01) {
      colorMap[transferLeafSelf] = NODE_COLORS.transfers_out;
      addNode(transferLeafSelf, 'Self-Transfer');
    }
    if (safeEtrf > 0.01) {
      colorMap[transferLeafEtrf] = NODE_COLORS.transfers_out;
      addNode(transferLeafEtrf, 'E-Transfer');
    }
  }

  const uncatLeafId = 'cashflow_uncategorized_leaf';
  if (safeUncategorized > 0) {
    colorMap[uncatLeafId] = NODE_COLORS.uncategorized_out;
    addNode(uncatLeafId, 'Uncategorized');
  }

  sources.forEach((s) => {
    const sid = s.id;
    const v = Number(s.value) || 0;
    const parts = proportionalSplitN(v, [safeSpending, safeInvest, safeTransfers, safeUncategorized, wSave]);
    const [toSpend, toInv, toTrans, toUncat, toSave] = parts;
    if (safeSpending > 0 && toSpend > 0) addLink(sid, 'spending', toSpend);
    if (safeInvest > 0 && toInv > 0) addLink(sid, 'investments', toInv);
    if (safeTransfers > 0 && toTrans > 0) addLink(sid, 'transfers_out', toTrans);
    if (safeUncategorized > 0 && toUncat > 0) addLink(sid, 'uncategorized_out', toUncat);
    if (needsSavingsNode && toSave > 0) addLink(sid, 'savings', toSave);
  });

  let spendingChildrenSum = 0;
  if (useSyntheticSpending) {
    addLink('spending', 'cashflow_spending_other', safeSpending);
    spendingChildrenSum = safeSpending;
  } else {
    spendingCats.forEach((item, index) => {
      const label = item.category || `Category ${index + 1}`;
      const id = sanitizeId(label);
      const value = Math.abs(Number(item.amount) || 0);
      if (value > 0 && safeSpending > 0) {
        addLink('spending', id, value);
        spendingChildrenSum += value;
      }
    });
  }

  const spendingRemainder = Math.round((safeSpending - spendingChildrenSum) * 100) / 100;
  if (safeSpending > 0 && spendingRemainder > 0.01) {
    const rid = 'cashflow_spending_remainder';
    if (!colorMap[rid]) {
      colorMap[rid] = CATEGORY_PALETTE[spendingCats.length % CATEGORY_PALETTE.length];
    }
    addNode(rid, 'Unallocated spending');
    addLink('spending', rid, spendingRemainder);
  }

  if (safeInvest > 0) {
    const invLeafId = sanitizeId('Securities Trading');
    addLink('investments', invLeafId, safeInvest);
  }

  if (safeTransfers > 0) {
    let transferChildrenSum = 0;
    if (safeSelf > 0.01) {
      addLink('transfers_out', transferLeafSelf, safeSelf);
      transferChildrenSum += safeSelf;
    }
    if (safeEtrf > 0.01) {
      addLink('transfers_out', transferLeafEtrf, safeEtrf);
      transferChildrenSum += safeEtrf;
    }
    const transferRemainder = Math.round((safeTransfers - transferChildrenSum) * 100) / 100;
    if (transferRemainder > 0.01) {
      const rid = 'cashflow_transfers_remainder';
      colorMap[rid] = NODE_COLORS.transfers_out;
      addNode(rid, 'Other transfers');
      addLink('transfers_out', rid, transferRemainder);
    }
  }

  if (safeUncategorized > 0) {
    addLink('uncategorized_out', uncatLeafId, safeUncategorized);
  }

  return { nodes, links, colorMap };
}

export default function CashflowSankey({
  spendingTotal,
  investmentOutTotal,
  transfersOutTotal,
  uncategorizedOutTotal,
  transfersOutSelf,
  transfersOutEtransfer,
  savingsFlow,
  sankeyMode,
  spendingCategoryBreakdowns,
  sourceSlices,
  formatCurrency,
  height = 520,
}) {
  const { nodes, links, colorMap } = useMemo(
    () =>
      buildCashflowSankeyData({
        spendingTotal,
        investmentOutTotal,
        transfersOutTotal,
        uncategorizedOutTotal,
        transfersOutSelf,
        transfersOutEtransfer,
        savingsFlow,
        sankeyMode,
        spendingCategoryBreakdowns,
        sourceSlices,
      }),
    [
      spendingTotal,
      investmentOutTotal,
      transfersOutTotal,
      uncategorizedOutTotal,
      transfersOutSelf,
      transfersOutEtransfer,
      savingsFlow,
      sankeyMode,
      spendingCategoryBreakdowns,
      sourceSlices,
    ]
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
      <div className="text-xs text-slate-300">Total: {formatAmount(node.value || 0)}</div>
    </div>
  );

  const linkTooltip = ({ link }) => (
    <div>
      <div className="font-medium mb-1">
        {link.source.label} &rarr; {link.target.label}
      </div>
      <div className="text-xs text-slate-300">Flow: {formatAmount(link.value || 0)}</div>
    </div>
  );

  return (
    <div style={{ width: '100%', height, minHeight: height }}>
      <ResponsiveSankey
        data={{ nodes, links }}
        margin={{ top: 24, right: 200, bottom: 24, left: 200 }}
        align="justify"
        colors={(node) => colorMap[node.id] || '#64748b'}
        nodeOpacity={0.8}
        nodeHoverOthersOpacity={0.1}
        nodeThickness={14}
        nodePadding={16}
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
