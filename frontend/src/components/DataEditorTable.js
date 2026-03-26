import React, { useCallback, useMemo } from 'react';
import { Filter, Triangle, X, Sparkles, Check, Unlink } from 'lucide-react';
import Select from 'react-select';
import TransactionTagInput from './TransactionTagInput';
import BaseTransactionTable from './BaseTransactionTable';
import CategoryPill from './CategoryPill';

const SELF_TRANSFER_CATEGORY = 'Self-Transfer';

const filterSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 32,
    background: '#09090b',
    borderColor: state.isFocused ? '#f59e0b' : '#27272a',
    boxShadow: state.isFocused ? '0 0 0 2px rgba(245,158,11,0.2)' : 'none',
    fontSize: '0.85rem',
    cursor: 'pointer',
  }),
  menu: (base) => ({
    ...base,
    background: '#18181b',
    border: '1px solid #27272a',
    borderRadius: 12,
    zIndex: 50,
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.85rem',
    background: state.isFocused ? 'rgba(245,158,11,0.12)' : 'transparent',
    color: state.isFocused ? '#f59e0b' : '#fafafa',
    cursor: 'pointer',
  }),
  multiValue: (base) => ({ ...base, background: 'rgba(245,158,11,0.14)', borderRadius: 9999 }),
  multiValueLabel: (base) => ({ ...base, color: '#f59e0b', fontSize: '0.8rem' }),
  input: (base) => ({ ...base, color: '#fafafa', fontSize: '0.85rem' }),
  placeholder: (base) => ({ ...base, color: '#a1a1aa' }),
};

/**
 * Interactive smart wrapper around BaseTransactionTable for the Data Editor tab.
 *
 * All mutation handlers, editing state, and filter state remain in DataEditorTab
 * and are passed here as props. This component is only responsible for building
 * the columns array and rendering interactive cells.
 */
export default function DataEditorTable({
  // Row data
  data,
  isLoading,

  // Editing state
  editingTransactionId,
  setEditingTransactionId,
  editingTagsTransactionId,
  setEditingTagsTransactionId,
  categorySelectRef,

  // Review / transfer state
  showOnlyNeedsReview,
  stickyReviewedIds,
  expandedTransferIds,
  setExpandedTransferIds,
  unlinkingSelfTransferId,
  markingReviewedId,

  // Bulk action state
  pendingBulkAction,
  bulkUpdating,

  // Lookup data
  categories,
  availableTags,

  // Mutation handlers
  applyCategory,
  applyTags,
  handleCategoryKeyDown,
  handleTagCreate,
  handleBulkUpdateYes,
  handleBulkUpdateNo,
  markTransactionReviewed,
  unlinkSelfTransferPair,
  getTransferMatchText,

  // Formatters
  formatCurrency,
  formatDate,

  // Column filter state
  activeFilterColumn,
  setActiveFilterColumn,
  filterDateFrom,
  setFilterDateFrom,
  filterDateTo,
  setFilterDateTo,
  filterDescription,
  setFilterDescription,
  filterAmountMin,
  setFilterAmountMin,
  filterAmountMax,
  setFilterAmountMax,
  filterCategories,
  setFilterCategories,
  filterTags,
  setFilterTags,
  dateSortOrder,
  setDateSortOrder,

  // Filter active indicators
  isDateFilterActive,
  isDescriptionFilterActive,
  isAmountFilterActive,
  isCategoryFilterActive,
  isTagsFilterActive,
}) {
  // ── Column definitions ──────────────────────────────────────────────────────

  const headerButtonClass =
    'flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors';
  const headerButtonRightClass =
    `${headerButtonClass} ml-auto justify-end`;

  const categoryLabelByName = useMemo(() => {
    const map = new Map();
    for (const c of categories || []) {
      const name = (c?.name || '').trim();
      if (!name) continue;
      const label = (c?.label || c?.name || '').trim();
      map.set(name, label || name);
    }
    return map;
  }, [categories]);

  const displayCategory = useCallback(
    (name) => {
      const key = (name || '').trim();
      if (!key) return '';
      return categoryLabelByName.get(key) || key;
    },
    [categoryLabelByName]
  );

  const columns = [
    {
      key: 'date',
      header: (
        <div className="data-editor-th-date-wrap">
          <button
            type="button"
            className={headerButtonClass}
            onClick={() => setActiveFilterColumn((c) => (c === 'date' ? null : 'date'))}
            aria-expanded={activeFilterColumn === 'date'}
            aria-label="Filter by date"
          >
            DATE
            {isDateFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
          </button>
          <button
            type="button"
            className="data-editor-date-sort-btn"
            onClick={() => setDateSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            title={
              dateSortOrder === 'desc'
                ? 'Sorted newest first — click for oldest first'
                : 'Sorted oldest first — click for newest first'
            }
            aria-label={
              dateSortOrder === 'desc'
                ? 'Sort by date: newest first. Click to sort oldest first.'
                : 'Sort by date: oldest first. Click to sort newest first.'
            }
          >
            <Triangle
              size={11}
              strokeWidth={2.25}
              className={`data-editor-date-sort-triangle${dateSortOrder === 'desc' ? ' data-editor-date-sort-triangle--desc' : ''}`}
              aria-hidden
            />
          </button>
        </div>
      ),
      headerClassName: isDateFilterActive ? 'data-editor-th-filter-active' : '',
      renderCell: (tx) => formatDate(tx.date),
    },
    {
      key: 'description',
      header: (
        <button
          type="button"
          className={headerButtonClass}
          onClick={() => setActiveFilterColumn((c) => (c === 'description' ? null : 'description'))}
          aria-expanded={activeFilterColumn === 'description'}
          aria-label="Filter by description"
        >
          DESCRIPTION
          {isDescriptionFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
        </button>
      ),
      headerClassName: isDescriptionFilterActive ? 'data-editor-th-filter-active' : '',
      renderCell: (tx) => {
        const isTransferExpandable =
          tx.is_transfer === true && Boolean(getTransferMatchText(tx));
        const isTransferExpanded = isTransferExpandable && expandedTransferIds.has(tx.id);
        const transferPillLabel =
          tx.category === SELF_TRANSFER_CATEGORY ? 'Self-Transfer' : 'Linked transfer';
        return (
          <div className="flex items-start gap-2 min-w-0">
            <span
              className="text-sm text-zinc-50 whitespace-normal break-words leading-snug"
              title={tx.description}
            >
              {tx.description}
            </span>
            {tx.is_transfer === true && (
              <button
                type="button"
                className="data-editor-transfer-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isTransferExpandable) return;
                  setExpandedTransferIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(tx.id)) next.delete(tx.id);
                    else next.add(tx.id);
                    return next;
                  });
                }}
                aria-expanded={isTransferExpanded}
                title={isTransferExpandable ? 'Show match details' : transferPillLabel}
              >
                {transferPillLabel}
                {isTransferExpandable ? (isTransferExpanded ? ' ▲' : ' ▼') : ''}
              </button>
            )}
          </div>
        );
      },
    },
    {
      key: 'category',
      header: (
        <button
          type="button"
          className={headerButtonClass}
          onClick={() => setActiveFilterColumn((c) => (c === 'category' ? null : 'category'))}
          aria-expanded={activeFilterColumn === 'category'}
          aria-label="Filter by category"
        >
          CATEGORY
          {isCategoryFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
        </button>
      ),
      headerClassName: isCategoryFilterActive ? 'data-editor-th-filter-active' : '',
      getCellClassName: (tx) => (editingTransactionId === tx.id ? 'data-editor-cell-edit' : ''),
      getCellProps: (tx) => ({
        onClick: () => editingTransactionId !== tx.id && setEditingTransactionId(tx.id),
      }),
      renderCell: (tx) =>
        editingTransactionId === tx.id ? (
          <select
            ref={categorySelectRef}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-md text-xs text-zinc-50 py-1 px-2 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
            value={tx.category || ''}
            onChange={(e) => applyCategory(tx.id, e.target.value)}
            onKeyDown={(e) => handleCategoryKeyDown(e, tx.id)}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id || c.name} value={c.name}>
                {c.label || c.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            {tx.needs_review && <span className="data-editor-needs-review-dot" aria-hidden />}
            {tx.category ? (
              <CategoryPill>{displayCategory(tx.category)}</CategoryPill>
            ) : (
              <span className="text-zinc-500 text-sm">—</span>
            )}
          </>
        ),
    },
    {
      key: 'amount',
      header: (
        <button
          type="button"
          className={headerButtonRightClass}
          onClick={() => setActiveFilterColumn((c) => (c === 'amount' ? null : 'amount'))}
          aria-expanded={activeFilterColumn === 'amount'}
          aria-label="Filter by amount"
        >
          AMOUNT
          {isAmountFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
        </button>
      ),
      headerClassName: `text-right${isAmountFilterActive ? ' data-editor-th-filter-active' : ''}`,
      kind: 'amount',
      getAmountValue: (tx) => Number(tx.amount) || 0,
      renderCell: (tx) => formatCurrency(tx.amount, tx.currency),
    },
    {
      key: 'tags',
      header: (
        <button
          type="button"
          className={headerButtonClass}
          onClick={() => setActiveFilterColumn((c) => (c === 'tags' ? null : 'tags'))}
          aria-expanded={activeFilterColumn === 'tags'}
          aria-label="Filter by tags"
        >
          TAGS
          {isTagsFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
        </button>
      ),
      headerClassName: isTagsFilterActive ? 'data-editor-th-filter-active' : '',
      getCellClassName: (tx) =>
        editingTagsTransactionId === tx.id
          ? 'data-editor-cell-edit data-editor-tags-cell-edit'
          : 'data-editor-tags-cell',
      getCellProps: (tx) => ({
        onClick: () =>
          editingTagsTransactionId !== tx.id && setEditingTagsTransactionId(tx.id),
      }),
      renderCell: (tx) =>
        editingTagsTransactionId === tx.id ? (
          <TransactionTagInput
            value={tx.tags}
            options={availableTags}
            onChange={(tags) => applyTags(tx.id, tags)}
            onCreateOption={handleTagCreate}
            autoFocus
          />
        ) : tx.tags.length > 0 ? (
          <div className="data-editor-tag-chips">
            {tx.tags.map((tag) => (
              <span key={tag} className="data-editor-tag-chip">
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-zinc-500 text-sm">—</span>
        ),
    },
    {
      key: 'actions',
      header: 'ACTIONS',
      headerClassName: 'data-editor-actions-col',
      cellClassName: 'data-editor-actions-cell',
      renderCell: (tx) => (
        <div className="data-editor-actions-cell-inner">
          {pendingBulkAction && pendingBulkAction.transactionId === tx.id && (
            <div className="data-editor-bulk-inline">
              <span
                className="inline-flex cursor-pointer items-center justify-center rounded p-1 text-zinc-400 hover:text-amber-500 transition-colors"
                style={{ pointerEvents: bulkUpdating ? 'none' : undefined }}
                title={(() => {
                  const parts = [];
                  if (tx.category) parts.push(tx.category);
                  if (tx.tags?.length)
                    parts.push(
                      tx.tags
                        .map((t) => (t.startsWith('#') ? t : `#${t}`))
                        .join(' ')
                    );
                  const applyTo = parts.length
                    ? `Apply ${parts.join(' and ')} to `
                    : 'Apply to ';
                  return `${applyTo}${pendingBulkAction.count} similar transaction${pendingBulkAction.count !== 1 ? 's' : ''}`;
                })()}
                onClick={handleBulkUpdateYes}
                onKeyDown={(e) => e.key === 'Enter' && handleBulkUpdateYes()}
                role="button"
                tabIndex={0}
                aria-label={`Apply to ${pendingBulkAction.count} similar transactions`}
              >
                <Sparkles size={18} />
              </span>
              <button
                type="button"
                className="data-editor-bulk-inline-dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  handleBulkUpdateNo();
                }}
                disabled={bulkUpdating}
                aria-label="Dismiss bulk action"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {tx.needs_review &&
            !(pendingBulkAction && pendingBulkAction.transactionId === tx.id) && (
              <button
                type="button"
                className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-400/10 p-1.5 text-zinc-400 hover:text-emerald-300 transition-colors"
                disabled={markingReviewedId === tx.id}
                title="Mark as reviewed — confirms this transaction is correct without changing category"
                aria-label="Mark as reviewed"
                onClick={(e) => {
                  e.stopPropagation();
                  markTransactionReviewed(tx.id);
                }}
              >
                <Check
                  size={18}
                  strokeWidth={2}
                  aria-hidden
                  className="data-editor-mark-reviewed-icon"
                />
              </button>
            )}
        </div>
      ),
    },
  ];

  // ── Filter row (second <tr> in <thead>) ─────────────────────────────────────
  const filterRow = (
    <tr className="data-editor-filter-row">
      <td className={activeFilterColumn === 'date' ? 'data-editor-filter-cell-active' : ''}>
        {activeFilterColumn === 'date' && (
          <div className="data-editor-filter-inputs">
            <input
              type="date"
              className="data-editor-filter-date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              aria-label="Date from"
            />
            <span className="data-editor-filter-sep">–</span>
            <input
              type="date"
              className="data-editor-filter-date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              aria-label="Date to"
            />
            <button
              type="button"
              className="data-editor-filter-clear-col"
              onClick={() => {
                setFilterDateFrom('');
                setFilterDateTo('');
              }}
              aria-label="Clear date filter"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </td>
      <td className={activeFilterColumn === 'description' ? 'data-editor-filter-cell-active' : ''}>
        {activeFilterColumn === 'description' && (
          <div className="data-editor-filter-inputs">
            <input
              type="text"
              className="data-editor-filter-text"
              value={filterDescription}
              onChange={(e) => setFilterDescription(e.target.value)}
              placeholder="Filter by description…"
              aria-label="Filter by description"
              autoFocus
            />
            <button
              type="button"
              className="data-editor-filter-clear-col"
              onClick={() => setFilterDescription('')}
              aria-label="Clear description filter"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </td>
      <td className={activeFilterColumn === 'category' ? 'data-editor-filter-cell-active' : ''}>
        {activeFilterColumn === 'category' && (
          <div className="data-editor-filter-inputs">
            <Select
              isMulti
              placeholder="Select categories…"
              value={filterCategories.map((c) => ({ value: c, label: c }))}
              options={categories.map((c) => ({ value: c.name, label: c.label || c.name }))}
              onChange={(selected) =>
                setFilterCategories((selected || []).map((o) => o.value))
              }
              styles={filterSelectStyles}
              classNamePrefix="data-editor-filter-select"
              menuPortalTarget={document.body}
            />
            <button
              type="button"
              className="data-editor-filter-clear-col"
              onClick={() => setFilterCategories([])}
              aria-label="Clear category filter"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </td>
      <td
        className={`text-right${activeFilterColumn === 'amount' ? ' data-editor-filter-cell-active' : ''}`}
      >
        {activeFilterColumn === 'amount' && (
          <div className="data-editor-filter-inputs data-editor-filter-inputs-right">
            <input
              type="number"
              className="data-editor-filter-number"
              placeholder="Min"
              value={filterAmountMin}
              onChange={(e) => setFilterAmountMin(e.target.value)}
              aria-label="Minimum amount"
            />
            <span className="data-editor-filter-sep">–</span>
            <input
              type="number"
              className="data-editor-filter-number"
              placeholder="Max"
              value={filterAmountMax}
              onChange={(e) => setFilterAmountMax(e.target.value)}
              aria-label="Maximum amount"
            />
            <button
              type="button"
              className="data-editor-filter-clear-col"
              onClick={() => {
                setFilterAmountMin('');
                setFilterAmountMax('');
              }}
              aria-label="Clear amount filter"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </td>
      <td className={activeFilterColumn === 'tags' ? 'data-editor-filter-cell-active' : ''}>
        {activeFilterColumn === 'tags' && (
          <div className="data-editor-filter-inputs">
            <Select
              isMulti
              placeholder="Select tags…"
              value={filterTags.map((t) => ({ value: t, label: t }))}
              options={availableTags.map((t) => ({ value: t, label: t }))}
              onChange={(selected) =>
                setFilterTags((selected || []).map((o) => o.value))
              }
              styles={filterSelectStyles}
              classNamePrefix="data-editor-filter-select"
              menuPortalTarget={document.body}
            />
            <button
              type="button"
              className="data-editor-filter-clear-col"
              onClick={() => setFilterTags([])}
              aria-label="Clear tags filter"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </td>
      <td className="data-editor-filter-row-actions" />
    </tr>
  );

  // ── Transfer detail expansion row ──────────────────────────────────────────

  const renderExtraRow = (tx) => {
    const transferMatchText = tx.is_transfer ? getTransferMatchText(tx) : null;
    const isTransferExpandable = tx.is_transfer === true && Boolean(transferMatchText);
    const isTransferExpanded = isTransferExpandable && expandedTransferIds.has(tx.id);
    if (!isTransferExpanded) return null;
    return (
      <tr className="data-editor-transfer-detail-row">
        <td colSpan={5} className="data-editor-transfer-detail-main-cell">
          <div className="data-editor-transfer-detail">
            <p className="data-editor-transfer-detail-text">{transferMatchText}</p>
          </div>
        </td>
        <td className="data-editor-actions-cell data-editor-transfer-detail-actions-cell">
          {tx.category === SELF_TRANSFER_CATEGORY ? (
            <button
              type="button"
              className="data-editor-unlink-self-transfer"
              disabled={unlinkingSelfTransferId === tx.id}
              title={unlinkingSelfTransferId === tx.id ? 'Unlinking…' : 'Unlink pair'}
              aria-label={
                unlinkingSelfTransferId === tx.id
                  ? 'Unlinking transfer pair'
                  : 'Unlink pair'
              }
              onClick={(e) => {
                e.stopPropagation();
                unlinkSelfTransferPair(tx.id);
              }}
            >
              <Unlink
                size={18}
                strokeWidth={2}
                aria-hidden
                className="data-editor-unlink-self-transfer-icon"
              />
            </button>
          ) : null}
        </td>
      </tr>
    );
  };

  // ── Row class ──────────────────────────────────────────────────────────────

  const getRowClassName = (tx) => {
    const isProcessedSticky =
      showOnlyNeedsReview && !tx.needs_review && stickyReviewedIds.includes(tx.id);
    return [
      tx.needs_review ? 'data-editor-row-needs-review' : '',
      isProcessedSticky ? 'data-editor-row-processed' : '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="glass-card data-editor-table-wrapper">
      <BaseTransactionTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        emptyMessage="No transactions yet. Connect your bank or upload statements to see them here."
        rowKey={(tx) => tx.id}
        getRowClassName={getRowClassName}
        filterRow={filterRow}
        renderExtraRow={renderExtraRow}
        tableClassName="data-editor-table"
        scrollClassName="data-editor-table-scroll"
      />
    </div>
  );
}
