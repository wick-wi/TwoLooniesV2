import React from 'react';
import { formatMoney } from '../utils/money';
import BaseTransactionTable from './BaseTransactionTable';
import CategoryPill from './CategoryPill';

const INCOME_CATS = new Set(['Income']);
const REFUND_KW = ['refund', 'reversal', 'chargeback', 'return'];

function classifyAmount(tx) {
  const amount = Number(tx.amount) || 0;
  if (amount === 0) return 'zero';
  if (amount > 0) {
    if (INCOME_CATS.has((tx.category || '').trim())) return 'income';
    const desc = (tx.description || '').toLowerCase();
    if (REFUND_KW.some((kw) => desc.includes(kw))) return 'refund';
    return 'refund';
  }
  return 'spending';
}

function formatTransactionDate(dateString) {
  if (!dateString) return '—';
  const parsed = new Date(dateString);
  return Number.isNaN(parsed.getTime())
    ? dateString
    : parsed.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

/**
 * Read-only smart wrapper around BaseTransactionTable for the Spending & Income tab.
 *
 * Receives the already-filtered, date-windowed, paged row slice from
 * SpendingIncomeTab and maps it to four strictly read-only columns.
 * No mutation handlers or editing state live here.
 */
export default function SpendingLedgerTable({ rows = [], displayCurrency = 'CAD', categoryEmojiByName = null }) {
  const columns = [
    {
      key: 'date',
      header: 'DATE',
      headerClassName: 'text-xs font-medium uppercase tracking-wider text-zinc-400 w-[9.5rem]',
      cellClassName: 'text-sm text-zinc-400 whitespace-nowrap w-[9.5rem]',
      renderCell: (tx) => formatTransactionDate(tx.date),
    },
    {
      key: 'description',
      header: 'DESCRIPTION',
      headerClassName: 'text-xs font-medium uppercase tracking-wider text-zinc-400',
      cellClassName: 'min-w-0',
      renderCell: (tx) => (
        <span
          className="text-sm text-zinc-50 whitespace-normal break-words leading-snug"
          title={tx.description || ''}
        >
          {tx.description || '—'}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'CATEGORY',
      headerClassName: 'text-xs font-medium uppercase tracking-wider text-zinc-400 w-[14rem]',
      cellClassName: 'w-[14rem] whitespace-nowrap',
      renderCell: (tx) => (
        <CategoryPill>
          {(() => {
            const name = (tx.category || 'Uncategorized').trim() || 'Uncategorized';
            const emoji = categoryEmojiByName && categoryEmojiByName[name];
            return emoji ? `${emoji} ${name}` : name;
          })()}
        </CategoryPill>
      ),
    },
    {
      key: 'amount',
      header: 'AMOUNT',
      headerClassName: 'text-xs font-medium uppercase tracking-wider text-zinc-400 text-right w-[9rem]',
      kind: 'amount',
      cellClassName: 'text-right font-mono',
      getAmountValue: (tx) => Number(tx.amount) || 0,
      renderCell: (tx) => {
        const a = Number(tx.amount) || 0;
        const cls = classifyAmount(tx);
        const ccy =
          tx.currency ||
          tx.iso_currency_code ||
          tx.unofficial_currency_code ||
          displayCurrency ||
          'CAD';
        const label = formatMoney(Math.abs(a), ccy, {
          minimumFractionDigits: 2,
        });
        return cls === 'spending' ? `-${label}` : `+${label}`;
      },
    },
  ];

  return (
    <BaseTransactionTable
      columns={columns}
      data={rows}
      emptyMessage="No transactions match the current filters."
      rowKey={(tx, i) => tx.id ?? i}
    />
  );
}
