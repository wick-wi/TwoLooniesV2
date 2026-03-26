import React, { useEffect, useMemo, useState } from 'react';
import './CsvReviewModal.css';

const ACCOUNT_TYPE_OPTIONS = ['depository', 'credit', 'investment', 'loan'];

const ACCOUNT_SUBTYPE_BY_TYPE = {
  depository: ['Chequing', 'Savings'],
  credit: ['Credit Card', 'Line of Credit', 'HELOC'],
  investment: ['TFSA', 'RRSP', 'FHSA', 'RESP', 'RDSP', 'RRIF', 'LIRA', 'Margin', 'Crypto', 'GIC'],
  loan: ['Line of Credit', 'Mortgage', 'Student Loan', 'AutoLoan', 'HELOC'],
};

const COMMON_PROVIDERS = ['Wealthsimple', 'RBC', 'TD', 'BMO', 'Scotiabank', 'CIBC', 'Tangerine', 'EQ Bank'];

function normalizedSubtype(type, subtype) {
  const options = ACCOUNT_SUBTYPE_BY_TYPE[type] || [];
  if (options.includes(subtype)) return subtype;
  return options[0] || 'Chequing';
}

function pickFirstNonEmpty(values, fallback = '') {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function summarizeGroupTransactions(transactions = []) {
  const txs = Array.isArray(transactions) ? transactions : [];
  let inflow = 0;
  let outflow = 0;
  let net = 0;
  const dates = [];
  txs.forEach((txn) => {
    const amount = Number(txn?.amount || 0);
    if (Number.isFinite(amount)) {
      if (amount >= 0) inflow += amount;
      else outflow += Math.abs(amount);
      net += amount;
    }
    const d = String(txn?.date || '').trim();
    if (d) dates.push(d);
  });
  const minDate = dates.length ? [...dates].sort()[0] : '';
  const maxDate = dates.length ? [...dates].sort().slice(-1)[0] : '';
  return {
    transactionCount: txs.length,
    dateMin: minDate,
    dateMax: maxDate,
    inflow,
    outflow,
    net,
    sampleTransactions: txs.slice(0, 5),
  };
}

function formatAmount(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CsvReviewModal({ files, onCancel, onConfirm, saving = false }) {
  const initialRows = useMemo(() => {
    const rows = [];
    (files || []).forEach((file, fileIndex) => {
      const groups = file.account_groups || [];
      groups.forEach((group, groupIndex) => {
        const type = pickFirstNonEmpty(
          [group.account_type_guess, group.account_type, file.account_type_guess],
          'depository'
        );
        const accountNumberGuess = pickFirstNonEmpty([
          group.account_number_guess,
          group.account_number,
          group.group_key && !String(group.group_key).startsWith('UnknownAccount-') ? group.group_key : '',
          file.account_number,
          file.account_id,
        ]);
        const providerGuess = pickFirstNonEmpty([
          group.provider_guess,
          group.provider,
          file.provider,
          file.target_provider,
        ]);
        const subtypeGuess = pickFirstNonEmpty([
          group.account_subtype_guess,
          group.account_subtype,
          group.account_subtype,
          file.account_type,
        ]);
        rows.push({
          key: `${fileIndex}:${groupIndex}`,
          fileIndex,
          groupIndex,
          filename: file.filename,
          groupKey: group.group_key || '',
          provider: providerGuess,
          accountType: type,
          accountSubtype: normalizedSubtype(type, subtypeGuess),
          accountNumber: accountNumberGuess,
          ...summarizeGroupTransactions(group.transactions || []),
        });
      });
    });
    return rows;
  }, [files]);

  const [rows, setRows] = useState(initialRows);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewedKeys, setReviewedKeys] = useState(new Set());
  useEffect(() => {
    setRows(initialRows);
    setCurrentIndex(0);
    setReviewedKeys(new Set());
  }, [initialRows]);

  const updateRow = (key, patch) => {
    setRows((prev) => {
      const targetIndex = prev.findIndex((row) => row.key === key);
      if (targetIndex < 0) return prev;
      const next = prev.map((row, idx) => {
        if (row.key === key) return { ...row, ...patch };
        // Provider behaves like a convenient default: carry it forward to subsequent groups.
        if (Object.prototype.hasOwnProperty.call(patch, 'provider') && idx > targetIndex) {
          return { ...row, provider: patch.provider };
        }
        return row;
      });
      return next;
    });
  };

  const allValid = rows.every(
    (row) =>
      String(row.provider || '').trim() &&
      String(row.accountType || '').trim() &&
      String(row.accountSubtype || '').trim() &&
      String(row.accountNumber || '').trim()
  );
  const currentRow = rows[currentIndex] || null;
  const currentIsValid = currentRow
    ? Boolean(
        String(currentRow.provider || '').trim() &&
          String(currentRow.accountType || '').trim() &&
          String(currentRow.accountSubtype || '').trim() &&
          String(currentRow.accountNumber || '').trim()
      )
    : false;
  const allReviewed = rows.length > 0 && rows.every((row) => reviewedKeys.has(row.key));
  const reviewedOrCurrentValid =
    rows.length > 0 &&
    rows.every((row) => {
      if (row.key === currentRow?.key) return currentIsValid;
      return reviewedKeys.has(row.key);
    });
  const isFirstGroup = currentIndex === 0;
  const isLastGroup = rows.length > 0 && currentIndex === rows.length - 1;

  const markCurrentReviewed = () => {
    if (!currentRow || !currentIsValid) return false;
    setReviewedKeys((prev) => {
      const next = new Set(prev);
      next.add(currentRow.key);
      return next;
    });
    return true;
  };

  const goNext = () => {
    if (!markCurrentReviewed()) return;
    setCurrentIndex((idx) => Math.min(rows.length - 1, idx + 1));
  };

  const goPrev = () => {
    setCurrentIndex((idx) => Math.max(0, idx - 1));
  };

  const handleConfirm = () => {
    const nextFiles = (files || []).map((f) => ({
      ...f,
      account_groups: (f.account_groups || []).map((g) => ({ ...g })),
    }));
    rows.forEach((row) => {
      const file = nextFiles[row.fileIndex];
      const group = file?.account_groups?.[row.groupIndex];
      if (!group) return;
      group.provider = row.provider.trim();
      group.account_type_guess = row.accountType;
      group.account_subtype = row.accountSubtype;
      group.account_number = row.accountNumber.trim();
    });
    onConfirm?.(nextFiles);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content modal-content-wide csv-review-modal">
        <div className="modal-header">
          <h2>Confirm CSV Accounts</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">Review each detected account group before saving.</p>
          {rows.length > 0 && currentRow ? (
            <>
              <div className="csv-review-progress">
                Reviewing account {currentIndex + 1} of {rows.length}
              </div>
              <div className="csv-review-list">
                {(() => {
                  const row = currentRow;
                  const subtypeOptions = ACCOUNT_SUBTYPE_BY_TYPE[row.accountType] || ['Chequing'];
                  return (
                    <div className="csv-review-card" key={row.key}>
                      <div className="csv-review-title">{row.filename}</div>
                      {row.groupKey ? <div className="csv-review-subtitle">Group: {row.groupKey}</div> : null}
                      <label>
                        Provider
                        <input
                          list="csv-provider-options"
                          value={row.provider}
                          onChange={(e) => updateRow(row.key, { provider: e.target.value })}
                        />
                      </label>
                      <label>
                        Account Type
                        <select
                          value={row.accountType}
                          onChange={(e) =>
                            updateRow(row.key, {
                              accountType: e.target.value,
                              accountSubtype: normalizedSubtype(e.target.value, row.accountSubtype),
                            })
                          }
                        >
                          {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Account Subtype
                        <select
                          value={row.accountSubtype}
                          onChange={(e) => updateRow(row.key, { accountSubtype: e.target.value })}
                        >
                          {subtypeOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Account Number
                        <input
                          value={row.accountNumber}
                          onChange={(e) => updateRow(row.key, { accountNumber: e.target.value })}
                        />
                      </label>
                      <div className="csv-review-context">
                        <div className="csv-review-context-title">Group context</div>
                        <div className="csv-review-stats">
                          <span>{row.transactionCount} txns</span>
                          <span>
                            {row.dateMin || 'N/A'} {row.dateMax ? `to ${row.dateMax}` : ''}
                          </span>
                        </div>
                        <div className="csv-review-stats">
                          <span>Inflow: +{formatAmount(row.inflow)}</span>
                          <span>Outflow: -{formatAmount(row.outflow)}</span>
                          <span>Net: {row.net >= 0 ? '+' : ''}{formatAmount(row.net)}</span>
                        </div>
                        <div className="csv-review-sample-title">Sample transactions</div>
                        {row.sampleTransactions.length > 0 ? (
                          <div className="csv-review-sample-list">
                            {row.sampleTransactions.map((txn, idx) => (
                              <div className="csv-review-sample-row" key={`${row.key}-txn-${idx}`}>
                                <span>{txn.date || 'N/A'}</span>
                                <span className="csv-review-sample-desc">{txn.description || '(no description)'}</span>
                                <span>{txn.amount >= 0 ? '+' : ''}{formatAmount(txn.amount)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="csv-review-sample-empty">No parsed transactions in this group.</div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          ) : null}
          <datalist id="csv-provider-options">
            {COMMON_PROVIDERS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="modal-footer">
          {!isFirstGroup && (
            <button type="button" className="btn-secondary" onClick={goPrev} disabled={saving}>
              Back
            </button>
          )}
          {!isLastGroup && (
            <button type="button" className="btn-secondary" onClick={goNext} disabled={!currentIsValid || saving}>
              Next
            </button>
          )}
          {isLastGroup && (
            <button
              type="button"
              onClick={handleConfirm}
              className="btn-primary"
              disabled={!allValid || !(allReviewed || reviewedOrCurrentValid) || saving}
            >
              {saving ? 'Saving...' : 'Confirm & Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

