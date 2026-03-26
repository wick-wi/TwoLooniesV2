import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { useAnalysis } from '../../context/AnalysisContext';
import { useUpload } from '../../context/UploadContext';
import UploadStatementModal from '../../components/UploadStatementModal';
import CsvReviewModal from '../../components/CsvReviewModal';
import { formatApiConnectionError, formatStatementUploadError } from '../../utils/statementUploadErrors';
import DataEditorTable from '../../components/DataEditorTable';
import { FileText, Trash2, RefreshCw, Plus, Landmark, Upload, Sparkles, ChevronDown, CheckSquare, Scale, ClipboardCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatMoney } from '../../utils/money';
import './DataEditorTab.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

/** Avoid infinite spinners if the API is down or hangs (axios default is no timeout). */
const API_TIMEOUT_MS = 45_000;

/** System-detected internal moves between accounts (unlink allowed); not credit-card payment links. */
const SELF_TRANSFER_CATEGORY = 'Self-Transfer';

function PlaidConnectButton({ linkToken, onSuccess, className, children }) {
  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });
  return (
    <button type="button" onClick={() => open()} disabled={!ready} className={className}>
      {children}
    </button>
  );
}

/**
 * Normalize API transaction to { id, date, description, amount, category, needs_review }
 */
function normalizeTransaction(tx, index) {
  if (!tx) return null;
  const date = tx.date ?? tx.transaction_date ?? tx.posted_at ?? '';
  const description = tx.name ?? tx.merchant_name ?? tx.description ?? tx.pending_transaction_id ?? 'Unknown';
  const amount = tx.amount ?? tx.authorized_amount ?? 0;
  const category = Array.isArray(tx.category)
    ? tx.category?.join(', ') ?? tx.personal_finance_category?.primary ?? ''
    : tx.category ?? tx.personal_finance_category?.primary ?? '';
  const needs_review = tx.needs_review === true;
  const tags = Array.isArray(tx.tags) ? tx.tags : [];
  const currency = tx.currency ?? tx.iso_currency_code ?? tx.unofficial_currency_code ?? null;
  const statement_id = tx.statement_id ?? null;
  const account_id = tx.account_id ?? null;
  const is_transfer = tx.is_transfer === true;
  const linked_transaction_id = tx.linked_transaction_id ?? null;
  return {
    id: tx.id ?? tx.transaction_id ?? index,
    account_id,
    date,
    description,
    amount,
    category,
    needs_review,
    tags,
    currency,
    statement_id,
    is_transfer,
    linked_transaction_id,
  };
}

function uploadErrorMessage(err) {
  return formatStatementUploadError(err);
}

export default function DataEditorTab() {
  const navigate = useNavigate();
  const { isAuthenticated, getAccessToken, user, loading: authLoading } = useAuth();
  const {
    transactions: contextTx,
    setAnalysisData,
    clearAnalysis,
    analysis,
    accounts,
    balances,
    source,
    accessToken,
    itemId,
    files,
  } = useAnalysis();
  const { startUpload } = useUpload();
  const [statements, setStatements] = useState([]);
  const [accountsWithStatements, setAccountsWithStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [csvReviewFiles, setCsvReviewFiles] = useState(null);
  const [savingCsvReview, setSavingCsvReview] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [selectedStatementIds, setSelectedStatementIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [detectingTransfers, setDetectingTransfers] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [categorizeSuccess, setCategorizeSuccess] = useState(null);
  const [linkToken, setLinkToken] = useState(null);
  const [linkTokenError, setLinkTokenError] = useState(null);
  const [linkTokenLoading, setLinkTokenLoading] = useState(false);
  /** False until the first create_link_token attempt finishes (avoids flashing "unavailable" before fetch). */
  const [linkTokenReady, setLinkTokenReady] = useState(false);
  const [showOnlyNeedsReview, setShowOnlyNeedsReview] = useState(false);
  /** IDs of transactions that stay visible under "Needs Review" filter after being categorized (cleared on refresh/filter change/bulk update) */
  const [stickyReviewedIds, setStickyReviewedIds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editingTransactionId, setEditingTransactionId] = useState(null);
  const [pendingBulkAction, setPendingBulkAction] = useState(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [availableTags, setAvailableTags] = useState([]);
  const [editingTagsTransactionId, setEditingTagsTransactionId] = useState(null);
  const categorySelectRef = React.useRef(null);
  const [expandedAccountIds, setExpandedAccountIds] = useState(() => {
    try {
      const raw = window.localStorage.getItem('twoLoonies.dataEditor.expandedAccountIds');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  });
  const [expandedTransferIds, setExpandedTransferIds] = useState(() => new Set());
  const [unlinkingSelfTransferId, setUnlinkingSelfTransferId] = useState(null);
  const [markingReviewedId, setMarkingReviewedId] = useState(null);

  // Column filter state
  const [filterDescription, setFilterDescription] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterAmountMin, setFilterAmountMin] = useState('');
  const [filterAmountMax, setFilterAmountMax] = useState('');
  const [filterCategories, setFilterCategories] = useState([]);
  const [filterTags, setFilterTags] = useState([]);
  const [activeFilterColumn, setActiveFilterColumn] = useState(null);
  /** 'desc' = newest first (default); 'asc' = oldest first */
  const [dateSortOrder, setDateSortOrder] = useState('desc');

  const token = getAccessToken?.();

  const fetchLinkToken = useCallback(async () => {
    if (!token) {
      setLinkToken(null);
      setLinkTokenLoading(false);
      setLinkTokenError(null);
      setLinkTokenReady(true);
      return;
    }
    setLinkTokenError(null);
    setLinkTokenLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/create_link_token`, null, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: API_TIMEOUT_MS,
      });
      setLinkToken(res.data.link_token);
    } catch (err) {
      console.error('Link token error:', err);
      const hint = formatApiConnectionError(err, 'Bank link');
      const msg =
        hint ||
        err.response?.data?.error ||
        err.response?.data?.detail ||
        err.message ||
        'Could not connect to bank linking service.';
      setLinkTokenError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      setLinkToken(null);
    } finally {
      setLinkTokenLoading(false);
      setLinkTokenReady(true);
    }
  }, [token]);

  useEffect(() => {
    fetchLinkToken();
  }, [fetchLinkToken]);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_BASE}/api/categories`).then((res) => {
      if (!cancelled && res.data?.categories) setCategories(res.data.categories);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    axios.get(`${API_BASE}/api/tags`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => { if (!cancelled && res.data?.tags) setAvailableTags(res.data.tags); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  const onPlaidSuccess = useCallback(
    async (public_token) => {
      if (!token) return;
      try {
        const exchangeRes = await axios.post(
          `${API_BASE}/api/exchange_public_token`,
          { public_token },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const item_id = exchangeRes.data?.item_id;
        if (!item_id) throw new Error('Bank link did not return an item id.');
        const txRes = await axios.post(
          `${API_BASE}/api/transactions`,
          { item_id },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (txRes.data.error) throw new Error(txRes.data.error);
        const analysisData = { ...txRes.data, item_id };
        setAnalysisData(analysisData);
        await axios.post(
          `${API_BASE}/api/save_analysis`,
          {
            source: 'plaid',
            summary: txRes.data.analysis || {},
            item_id: item_id || 'unknown',
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        navigate('/dashboard');
      } catch (err) {
        console.error('Plaid flow error:', err);
        const d = err.response?.data?.detail;
        setError(
          (typeof d === 'string' ? d : null) ||
            err.response?.data?.error ||
            err.message ||
            'Something went wrong.'
        );
      }
    },
    [token, setAnalysisData, navigate]
  );

  const fetchUserData = useCallback(async (options = {}) => {
    const { background } = options;
    if (!token) {
      if (!background) setLoading(false);
      return;
    }
    if (!background) setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/user_data`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: API_TIMEOUT_MS,
      });
      setStatements(res.data.statements || []);
      const accounts = res.data.accounts || [];
      const stmts = res.data.statements || [];
      setAccountsWithStatements(
        res.data.accounts_with_statements ??
          accounts.map((acc) => ({ ...acc, statements: stmts.filter((s) => s.account_id === acc.id) }))
      );
      setAnalysisData(res.data);
      setStickyReviewedIds([]);
    } catch (err) {
      const hint = formatApiConnectionError(err, 'Loading data');
      setError(
        hint ||
          err.response?.data?.detail ||
          err.message ||
          'Failed to load data'
      );
      setStatements([]);
      clearAnalysis?.();
    } finally {
      if (!background) setLoading(false);
    }
  }, [token, setAnalysisData, clearAnalysis]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/', { state: { showLogin: true } });
      return;
    }
    fetchUserData();
  }, [isAuthenticated, authLoading, token, fetchUserData, navigate]);

  useEffect(() => {
    try {
      window.localStorage.setItem('twoLoonies.dataEditor.expandedAccountIds', JSON.stringify(expandedAccountIds));
    } catch (_) {
      // ignore (private mode / disabled storage)
    }
  }, [expandedAccountIds]);

  const handleDeleteStatement = async (statement) => {
    if (!token) return;
    const id = statement?.id ?? statement;
    const txCount = statement?.transactions?.length ?? 0;
    const msg =
      txCount > 0
        ? `Remove this statement? All ${txCount} transactions from this statement will also be deleted. This cannot be undone.`
        : 'Remove this statement? This cannot be undone.';
    if (!window.confirm(msg)) return;
    setDeletingId(id);
    try {
      const res = await axios.delete(`${API_BASE}/api/statements/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const deleteError = res?.data?.pdf_delete_error;
      if (deleteError) {
        setError(`Statement deleted, but uploaded file deletion failed: ${deleteError}`);
      } else if (res?.data?.pdf_deleted === true) {
        setCategorizeSuccess('Statement and underlying uploaded file deleted.');
        setError(null);
      } else {
        setCategorizeSuccess('Statement deleted.');
        setError(null);
      }
      // Refetch so we get correct accounts_with_statements (delete response doesn't include it)
      await fetchUserData({ background: true });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleStatementSelected = (id) => {
    setSelectedStatementIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAccountStatements = (acc) => {
    const stmtIds = (acc.statements || []).map((s) => s.id);
    setSelectedStatementIds((prev) => {
      const next = new Set(prev);
      const allSelected = stmtIds.every((id) => prev.has(id));
      if (allSelected) {
        stmtIds.forEach((id) => next.delete(id));
      } else {
        stmtIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleBulkDeleteStatements = async () => {
    if (!token || selectedStatementIds.size === 0) return;
    const ids = Array.from(selectedStatementIds);
    const totalTx = statements
      .filter((s) => selectedStatementIds.has(s.id))
      .reduce((sum, s) => sum + (s.transactions?.length ?? 0), 0);
    const msg = totalTx > 0
      ? `Delete ${ids.length} statement${ids.length !== 1 ? 's' : ''} and their ${totalTx} transaction${totalTx !== 1 ? 's' : ''}? This cannot be undone.`
      : `Delete ${ids.length} statement${ids.length !== 1 ? 's' : ''}? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    setBulkDeleting(true);
    try {
      const res = await axios.post(`${API_BASE}/api/statements/bulk-delete`, { statement_ids: ids }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const deletedCount = res?.data?.deleted_count ?? ids.length;
      const pdfDeletedCount = res?.data?.pdf_deleted_count ?? 0;
      const failures = Array.isArray(res?.data?.pdf_delete_failures) ? res.data.pdf_delete_failures : [];
      if (failures.length > 0) {
        const reasons = failures
          .slice(0, 3)
          .map((f) => f?.reason)
          .filter(Boolean)
          .join(' | ');
        const suffix = reasons ? ` ${reasons}` : '';
        setError(
          `Deleted ${deletedCount} statement${deletedCount === 1 ? '' : 's'}, but uploaded file deletion failed for ${failures.length}.${suffix}`
        );
      } else {
        setCategorizeSuccess(
          `Deleted ${deletedCount} statement${deletedCount === 1 ? '' : 's'} and ${pdfDeletedCount} uploaded file${pdfDeletedCount === 1 ? '' : 's'}.`
        );
        setError(null);
      }
      setSelectedStatementIds(new Set());
      await fetchUserData({ background: true });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to delete statements');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleRerunAnalysis = async () => {
    if (!token) return;
    setRerunning(true);
    setError(null);
    try {
      const res = await axios.post(
        `${API_BASE}/api/rerun_analysis`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setStatements(res.data.statements || []);
      setAccountsWithStatements(res.data.accounts_with_statements || []);
      setAnalysisData({
        transactions: res.data.transactions,
        analysis: res.data.analysis,
        source: 'pdf',
        balances: res.data.balances,
      });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to rerun');
    } finally {
      setRerunning(false);
    }
  };

  const handleDetectInternalTransfers = async () => {
    if (!token) return;
    setDetectingTransfers(true);
    setError(null);
    try {
      const res = await axios.post(
        `${API_BASE}/api/detect-internal-transfers`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // Keep current statements/accounts; just refresh transactions + analysis.
      setAnalysisData({
        transactions: res.data.transactions,
        analysis: res.data.analysis,
        source: 'pdf',
      });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to detect self-transfers');
    } finally {
      setDetectingTransfers(false);
    }
  };

  const handleCategorizeWithAI = async () => {
    if (!user?.id || !supabase) {
      setError('Supabase is not configured or you are not signed in.');
      return;
    }
    const token = getAccessToken();
    if (!token) {
      setError('Session expired. Please sign out and sign in again.');
      return;
    }
    setCategorizing(true);
    setError(null);
    setCategorizeSuccess(null);
    try {
      let totalUpdated = 0;
      const maxRounds = 20;
      for (let round = 0; round < maxRounds; round++) {
        const { data, error: fnError } = await supabase.functions.invoke('categorize-transaction', {
          body: { user_id: user.id },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (fnError) {
          let message = fnError.message || 'Categorize request failed';
          if (fnError.context && typeof fnError.context.json === 'function') {
            try {
              const body = await fnError.context.json();
              if (body?.error) message = body.error;
            } catch (_) { /* use fnError.message */ }
          }
          throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);
        totalUpdated += data?.updated ?? 0;
        if (!data?.has_more) break;
      }
      const message =
        totalUpdated === 0
          ? 'No uncategorized transactions to update.'
          : totalUpdated === 1
            ? 'Categorized 1 transaction.'
            : `Categorized ${totalUpdated} transactions.`;
      setCategorizeSuccess(message);
      await fetchUserData();
    } catch (err) {
      setCategorizeSuccess(null);
      setError(err.message || 'Failed to categorize transactions');
    } finally {
      setCategorizing(false);
    }
  };

  const onUploadSuccess = async (data) => {
    setShowUploadModal(false);
    const skipNote =
      data?.skipped_duplicates?.length > 0
        ? `Already in your account (skipped): ${data.skipped_duplicates.map((s) => s.filename).join(', ')}`
        : null;
    if (skipNote) setError(skipNote);
    else setError(null);

    if (!token || !data.files?.length) {
      setAnalysisData(data);
      return;
    }
    const hasCsvGroups = data.files.some((f) => Array.isArray(f.account_groups) && f.account_groups.length > 0);
    if (hasCsvGroups) {
      setCsvReviewFiles(data.files);
      return;
    }
    try {
      const payload = { statements: data.files };
      await axios.post(`${API_BASE}/api/save_statements`, payload, { headers: { Authorization: `Bearer ${token}` } });
      await fetchUserData();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to save statements');
    }
  };

  const handleCsvReviewConfirm = async (confirmedFiles) => {
    if (!token) return;
    setSavingCsvReview(true);
    setError(null);
    try {
      await axios.post(
        `${API_BASE}/api/save_statements`,
        { statements: confirmedFiles },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setCsvReviewFiles(null);
      await fetchUserData();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to save reviewed CSV statements');
    } finally {
      setSavingCsvReview(false);
    }
  };

  const applyCategory = useCallback(
    async (transactionId, newCategory) => {
      if (!token || !newCategory?.trim()) return;
      const previous = {
        transactions: contextTx,
        analysis,
        accounts,
        balances,
        source,
        access_token: accessToken,
        item_id: itemId,
        files,
      };
      const updatedTransactions = contextTx.map((t) =>
        t.id === transactionId ? { ...t, category: newCategory.trim(), needs_review: false } : t
      );
      setAnalysisData({ ...previous, transactions: updatedTransactions });
      setEditingTransactionId(null);
      setError(null);
      if (showOnlyNeedsReview) {
        setStickyReviewedIds((prev) => (prev.includes(transactionId) ? prev : [...prev, transactionId]));
      }
      try {
        const res = await axios.patch(
          `${API_BASE}/api/transactions/${transactionId}/category`,
          { category: newCategory.trim() },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = res.data;
        if (data?.has_similar_pending && data?.similar_count > 0) {
          setPendingBulkAction({
            transactionId,
            count: data.similar_count,
            description: data.similar_description ?? '',
            ...(data.similar_amount != null && { similar_amount: data.similar_amount }),
          });
        } else {
          setPendingBulkAction((prev) => prev?.transactionId === transactionId ? null : prev);
        }
      } catch (err) {
        setAnalysisData(previous);
        setError(err.response?.data?.detail || err.message || 'Failed to update category');
      }
    },
    [token, contextTx, analysis, accounts, balances, source, accessToken, itemId, files, setAnalysisData, showOnlyNeedsReview]
  );

  const markTransactionReviewed = useCallback(
    async (transactionId) => {
      if (!token) return;
      const previous = {
        transactions: contextTx,
        analysis,
        accounts,
        balances,
        source,
        access_token: accessToken,
        item_id: itemId,
        files,
      };
      const updatedTransactions = contextTx.map((t) =>
        t.id === transactionId ? { ...t, needs_review: false } : t
      );
      setAnalysisData({ ...previous, transactions: updatedTransactions });
      setError(null);
      if (showOnlyNeedsReview) {
        setStickyReviewedIds((prev) => (prev.includes(transactionId) ? prev : [...prev, transactionId]));
      }
      setMarkingReviewedId(transactionId);
      try {
        const res = await axios.patch(
          `${API_BASE}/api/transactions/${transactionId}/reviewed`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const raw = res.data?.transaction;
        if (raw) {
          const normalized = normalizeTransaction(raw, 0);
          if (normalized) {
            const merged = updatedTransactions.map((t) =>
              t.id === transactionId ? { ...t, ...normalized } : t
            );
            setAnalysisData({ ...previous, transactions: merged });
          }
        }
      } catch (err) {
        setAnalysisData(previous);
        setStickyReviewedIds((prev) => prev.filter((id) => id !== transactionId));
        setError(err.response?.data?.detail || err.message || 'Failed to mark as reviewed');
      } finally {
        setMarkingReviewedId(null);
      }
    },
    [token, contextTx, analysis, accounts, balances, source, accessToken, itemId, files, setAnalysisData, showOnlyNeedsReview]
  );

  const unlinkSelfTransferPair = useCallback(
    async (transactionId) => {
      if (!token) return;
      const tx = contextTx.find((t) => t.id === transactionId);
      if (!tx || tx.category !== SELF_TRANSFER_CATEGORY || !tx.linked_transaction_id) return;
      const partnerId = tx.linked_transaction_id;
      const previous = {
        transactions: contextTx,
        analysis,
        accounts,
        balances,
        source,
        access_token: accessToken,
        item_id: itemId,
        files,
      };
      const applyUnlink = (list) =>
        list.map((t) =>
          t.id === transactionId || t.id === partnerId
            ? {
                ...t,
                is_transfer: false,
                linked_transaction_id: null,
                category: 'Uncategorized',
                needs_review: true,
              }
            : t
        );
      setAnalysisData({ ...previous, transactions: applyUnlink(previous.transactions) });
      setExpandedTransferIds((prev) => {
        const next = new Set(prev);
        next.delete(transactionId);
        next.delete(partnerId);
        return next;
      });
      setUnlinkingSelfTransferId(transactionId);
      setError(null);
      try {
        const res = await axios.post(
          `${API_BASE}/api/transactions/${transactionId}/unlink-self-transfer`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const updated = res.data?.transactions;
        if (Array.isArray(updated) && updated.length > 0) {
          const byId = new Map(updated.map((raw) => [raw.id, normalizeTransaction(raw)]));
          const merged = applyUnlink(previous.transactions).map((t) => byId.get(t.id) ?? t);
          setAnalysisData({ ...previous, transactions: merged });
        }
      } catch (err) {
        setAnalysisData(previous);
        setError(err.response?.data?.detail || err.message || 'Failed to unlink transfer');
      } finally {
        setUnlinkingSelfTransferId(null);
      }
    },
    [token, contextTx, analysis, accounts, balances, source, accessToken, itemId, files, setAnalysisData]
  );

  const handleCategoryKeyDown = useCallback(
    (e, transactionId) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = categorySelectRef.current?.value;
        if (value) applyCategory(transactionId, value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditingTransactionId(null);
      }
    },
    [applyCategory]
  );

  const applyTags = useCallback(
    async (transactionId, newTags) => {
      if (!token) return;
      const previous = {
        transactions: contextTx,
        analysis,
        accounts,
        balances,
        source,
        access_token: accessToken,
        item_id: itemId,
        files,
      };
      const updatedTransactions = contextTx.map((t) =>
        t.id === transactionId ? { ...t, tags: newTags } : t
      );
      setAnalysisData({ ...previous, transactions: updatedTransactions });
      setError(null);
      try {
        const res = await axios.patch(
          `${API_BASE}/api/transactions/${transactionId}/tags`,
          { tags: newTags },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = res.data;
        if (data?.has_similar_pending && data?.similar_count > 0) {
          if (!pendingBulkAction || pendingBulkAction.transactionId !== transactionId) {
            setPendingBulkAction({
              transactionId,
              count: data.similar_count,
              description: data.similar_description ?? '',
              ...(data.similar_amount != null && { similar_amount: data.similar_amount }),
            });
          }
        }
      } catch (err) {
        setAnalysisData(previous);
        setError(err.response?.data?.detail || err.message || 'Failed to update tags');
      }
    },
    [token, contextTx, analysis, accounts, balances, source, accessToken, itemId, files, setAnalysisData, pendingBulkAction]
  );

  const handleTagCreate = useCallback((tag) => {
    setAvailableTags((prev) => (prev.includes(tag) ? prev : [...prev, tag].sort()));
  }, []);

  const handleBulkUpdateYes = useCallback(async () => {
    if (!token || !pendingBulkAction) return;
    const txRow = contextTx.find((t) => t.id === pendingBulkAction.transactionId);
    if (!txRow) return;
    const bulkPayload = { description: pendingBulkAction.description };
    if (txRow.category) bulkPayload.category = txRow.category;
    if (txRow.tags?.length > 0) bulkPayload.tags = txRow.tags;
    if (pendingBulkAction.similar_amount != null) bulkPayload.amount = pendingBulkAction.similar_amount;
    if (!bulkPayload.category && !bulkPayload.tags) {
      setPendingBulkAction(null);
      return;
    }
    setBulkUpdating(true);
    setError(null);
    try {
      const res = await axios.patch(
        `${API_BASE}/api/transactions/bulk-update-category`,
        bulkPayload,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const txList = res.data?.transactions;
      if (Array.isArray(txList) && txList.length > 0) {
        setAnalysisData({
          transactions: txList,
          analysis,
          accounts,
          balances,
          source,
          access_token: accessToken,
          item_id: itemId,
          files,
        });
      } else if (Array.isArray(txList)) {
        // 0 rows updated: API returned full list as []; keep current transactions so UI does not go blank
      } else {
        await fetchUserData({ background: true });
      }
      setPendingBulkAction(null);
      setStickyReviewedIds([]);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Bulk update failed');
    } finally {
      setBulkUpdating(false);
    }
  }, [
    token,
    pendingBulkAction,
    contextTx,
    setAnalysisData,
    analysis,
    accounts,
    balances,
    source,
    accessToken,
    itemId,
    files,
    fetchUserData,
  ]);

  const handleBulkUpdateNo = useCallback(() => {
    setPendingBulkAction(null);
  }, []);

  const formatCurrency = (value, currency) =>
    formatMoney(value, currency || 'CAD', { minimumFractionDigits: 2 });

  const formatDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    return isNaN(date.getTime()) ? d : date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getStatementValidation = (statement) => {
    const applicable = statement?.validation_applicable === true;
    const cashApplicable = statement?.cash_validation_applicable === true;
    const cashBalancesReconciled = statement?.cash_balances_reconciled === true;
    const balancesReconciled = statement?.balances_reconciled === true;
    const balanceIconActive =
      (applicable && balancesReconciled) || (cashApplicable && cashBalancesReconciled);
    const allReviewed = statement?.all_reviewed === true;
    const fullyValidated = statement?.fully_validated === true;
    return {
      applicable,
      cashApplicable,
      cashBalancesReconciled,
      balancesReconciled,
      balanceIconActive,
      allReviewed,
      fullyValidated,
    };
  };

  // Memoize derived transactions so downstream `useMemo` dependencies remain stable under CI/ESLint.
  const displayTransactionsRaw = React.useMemo(() => (
    contextTx?.length > 0
      ? contextTx
          .map((t, i) => normalizeTransaction(t, i))
          .filter(Boolean)
      : []
  ), [contextTx]);
  const afterStatementFilter = selectedStatementIds.size > 0
    ? displayTransactionsRaw.filter((tx) => tx.statement_id && selectedStatementIds.has(tx.statement_id))
    : displayTransactionsRaw;
  const afterNeedsReview = showOnlyNeedsReview
    ? afterStatementFilter.filter(
        (tx) => tx.needs_review === true || stickyReviewedIds.includes(tx.id)
      )
    : afterStatementFilter;

  const displayTransactions = React.useMemo(() => {
    let list = afterNeedsReview;
    const descTrim = filterDescription.trim();
    if (descTrim) {
      const lower = descTrim.toLowerCase();
      list = list.filter((tx) => String(tx.description || '').toLowerCase().includes(lower));
    }
    if (filterDateFrom || filterDateTo) {
      const from = filterDateFrom ? new Date(filterDateFrom) : null;
      const to = filterDateTo ? new Date(filterDateTo) : null;
      list = list.filter((tx) => {
        const d = tx.date ? new Date(tx.date) : null;
        if (!d || isNaN(d.getTime())) return false;
        if (from && d < from) return false;
        if (to) {
          const toEnd = new Date(to);
          toEnd.setHours(23, 59, 59, 999);
          if (d > toEnd) return false;
        }
        return true;
      });
    }
    const minNum = filterAmountMin !== '' ? parseFloat(filterAmountMin, 10) : null;
    const maxNum = filterAmountMax !== '' ? parseFloat(filterAmountMax, 10) : null;
    if (minNum != null && !Number.isNaN(minNum)) {
      list = list.filter((tx) => Number(tx.amount) >= minNum);
    }
    if (maxNum != null && !Number.isNaN(maxNum)) {
      list = list.filter((tx) => Number(tx.amount) <= maxNum);
    }
    if (filterCategories.length > 0) {
      const set = new Set(filterCategories);
      list = list.filter((tx) => set.has((tx.category || '').trim()));
    }
    if (filterTags.length > 0) {
      const set = new Set(filterTags);
      list = list.filter((tx) => Array.isArray(tx.tags) && tx.tags.some((t) => set.has(t)));
    }
    const cmp = (a, b) => (a.date || '').localeCompare(b.date || '');
    list = [...list].sort((a, b) => (dateSortOrder === 'desc' ? -cmp(a, b) : cmp(a, b)));
    return list;
  }, [
    afterNeedsReview,
    filterDescription,
    filterDateFrom,
    filterDateTo,
    filterAmountMin,
    filterAmountMax,
    filterCategories,
    filterTags,
    dateSortOrder,
  ]);

  const accountIdToName = React.useMemo(() => {
    const map = new Map();
    const list = (accountsWithStatements && accountsWithStatements.length > 0)
      ? accountsWithStatements
      : (accounts || []);
    (list || []).forEach((a) => {
      if (a && a.id) map.set(a.id, a.name || a.provider || 'Account');
    });
    return map;
  }, [accountsWithStatements, accounts]);

  const transactionsById = React.useMemo(() => {
    const map = new Map();
    (displayTransactionsRaw || []).forEach((t) => {
      if (t && t.id != null) map.set(t.id, t);
    });
    return map;
  }, [displayTransactionsRaw]);

  const getTransferMatchText = useCallback((tx) => {
    if (!tx || !tx.linked_transaction_id) return null;
    const other = transactionsById.get(tx.linked_transaction_id);
    if (!other) return null;

    const out = Number(tx.amount) < 0 ? tx : other;
    const inn = Number(tx.amount) < 0 ? other : tx;

    const outAcc = accountIdToName.get(out.account_id) || 'Unknown account';
    const inAcc = accountIdToName.get(inn.account_id) || 'Unknown account';
    const outDate = formatDate(out.date);
    const inDate = formatDate(inn.date);
    return `Matched: from ${outAcc} on ${outDate} to ${inAcc} on ${inDate}.`;
  }, [transactionsById, accountIdToName]);

  const hasActiveFilters =
    activeFilterColumn != null ||
    filterDescription.trim() !== '' ||
    filterDateFrom !== '' ||
    filterDateTo !== '' ||
    filterAmountMin !== '' ||
    filterAmountMax !== '' ||
    filterCategories.length > 0 ||
    filterTags.length > 0;

  const isDescriptionFilterActive = filterDescription.trim() !== '';
  const isDateFilterActive = filterDateFrom !== '' || filterDateTo !== '';
  const isAmountFilterActive = filterAmountMin !== '' || filterAmountMax !== '';
  const isCategoryFilterActive = filterCategories.length > 0;
  const isTagsFilterActive = filterTags.length > 0;

  const clearFilters = useCallback(() => {
    setFilterDescription('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterAmountMin('');
    setFilterAmountMax('');
    setFilterCategories([]);
    setFilterTags([]);
    setActiveFilterColumn(null);
  }, []);

  useEffect(() => {
    if (activeFilterColumn == null) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setActiveFilterColumn(null);
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeFilterColumn]);

  return (
    <div className="data-editor-tab">
      {error && (
        <div className="data-editor-error">
          {typeof error === 'object' && error !== null && 'message' in error
            ? error.message
            : typeof error === 'object'
              ? JSON.stringify(error)
              : error}
        </div>
      )}
      {categorizeSuccess && (
        <div className="data-editor-success">
          {categorizeSuccess}
        </div>
      )}

      {/* Actions */}
      <section className="data-editor-actions">
        <h2 className="data-editor-section-title">Data Sources</h2>
        <div className="data-editor-buttons">
          {linkToken ? (
            <PlaidConnectButton linkToken={linkToken} onSuccess={onPlaidSuccess} className="data-editor-btn data-editor-btn-primary">
              <Landmark size={18} /> Connect Bank
            </PlaidConnectButton>
          ) : linkTokenError ? (
            <button type="button" onClick={fetchLinkToken} className="data-editor-btn data-editor-btn-secondary">
              Retry Connect Bank
            </button>
          ) : !linkTokenReady || linkTokenLoading ? (
            <button type="button" disabled className="data-editor-btn data-editor-btn-secondary opacity-60">
              Loading...
            </button>
          ) : (
            <button type="button" disabled className="data-editor-btn data-editor-btn-secondary opacity-60">
              Bank link unavailable
            </button>
          )}
          <button onClick={() => setShowUploadModal(true)} className="data-editor-btn data-editor-btn-primary">
            <Upload size={18} /> Upload Statement
          </button>
          {statements.length > 0 && (
            <button
              onClick={handleRerunAnalysis}
              disabled={rerunning}
              className="data-editor-btn data-editor-btn-secondary"
            >
              <RefreshCw size={18} className={rerunning ? 'spin' : ''} /> {rerunning ? 'Rerunning...' : 'Rerun Analysis'}
            </button>
          )}
          {statements.length > 0 && (
            <button
              onClick={handleDetectInternalTransfers}
              disabled={detectingTransfers}
              className="data-editor-btn data-editor-btn-secondary"
              title="Find and link self-transfers across your accounts"
            >
              <RefreshCw size={18} className={detectingTransfers ? 'spin' : ''} /> {detectingTransfers ? 'Detecting self-transfers...' : 'Detect self-transfers'}
            </button>
          )}
          <button
            onClick={handleCategorizeWithAI}
            disabled={categorizing || !user?.id || !supabase}
            className="data-editor-btn data-editor-btn-primary"
            title="Categorize uncategorized transactions using AI"
          >
            <Sparkles size={18} className={categorizing ? 'spin' : ''} />
            {categorizing ? 'Categorizing...' : 'Categorize with AI'}
          </button>
        </div>

        {statements.length === 0 ? (
          <div className="glass-card data-editor-empty">
            <FileText size={48} strokeWidth={1} className="data-editor-empty-icon" />
            <p>No statements yet. Connect your bank or upload PDF statements to get started.</p>
            <div className="data-editor-empty-buttons">
              {linkToken ? (
                <PlaidConnectButton linkToken={linkToken} onSuccess={onPlaidSuccess} className="data-editor-btn data-editor-btn-primary">
                  <Landmark size={18} /> Connect Bank Account
                </PlaidConnectButton>
              ) : linkTokenError ? (
                <button type="button" onClick={fetchLinkToken} className="data-editor-btn data-editor-btn-secondary">
                  Retry Connect Bank
                </button>
              ) : !linkTokenReady || linkTokenLoading ? (
                <button type="button" disabled className="data-editor-btn data-editor-btn-secondary opacity-60">
                  Loading Plaid...
                </button>
              ) : (
                <button type="button" disabled className="data-editor-btn data-editor-btn-secondary opacity-60">
                  Bank link unavailable
                </button>
              )}
              <button onClick={() => setShowUploadModal(true)} className="data-editor-btn data-editor-btn-primary">
                <Plus size={18} /> Upload Statement
              </button>
            </div>
            {linkTokenError && <p className="data-editor-empty-error">{linkTokenError}</p>}
          </div>
        ) : (
          <>
            {selectedStatementIds.size > 0 && (
              <div className="data-editor-selection-bar">
                <span className="data-editor-selection-count">
                  <CheckSquare size={16} />
                  {selectedStatementIds.size} statement{selectedStatementIds.size !== 1 ? 's' : ''} selected
                  <span className="data-editor-selection-filter-hint">
                    &middot; showing {afterStatementFilter.length} of {displayTransactionsRaw.length} transaction{displayTransactionsRaw.length !== 1 ? 's' : ''}
                  </span>
                </span>
                <button
                  onClick={handleBulkDeleteStatements}
                  disabled={bulkDeleting}
                  className="data-editor-btn-remove data-editor-btn-bulk-delete"
                >
                  <Trash2 size={16} /> {bulkDeleting ? 'Deleting...' : 'Delete Selected'}
                </button>
                <button
                  onClick={() => setSelectedStatementIds(new Set())}
                  className="data-editor-btn-selection-clear"
                >
                  Clear Selection
                </button>
              </div>
            )}
            <div className="glass-card data-editor-accounts">
              {accountsWithStatements.map((acc) => {
                const accStmtIds = (acc.statements || []).map((s) => s.id);
                const allChecked = accStmtIds.length > 0 && accStmtIds.every((id) => selectedStatementIds.has(id));
                const someChecked = !allChecked && accStmtIds.some((id) => selectedStatementIds.has(id));
                const accountType = (acc.account_type || '').toLowerCase();
                const validationApplicable = accountType === 'depository' || accountType === 'credit';
                const isInvestment = accountType === 'investment';
                const statements = acc.statements || [];
                const statementBalanceOk = (s) => {
                  if (validationApplicable) return s.balances_reconciled === true;
                  if (isInvestment) {
                    if (s.cash_validation_applicable) return s.cash_balances_reconciled === true;
                    return true;
                  }
                  return false;
                };
                const allStatementsBalancesReconciled =
                  statements.length > 0 && statements.every(statementBalanceOk);
                const statementReviewOk = (s) => s.all_reviewed === true;
                const allStatementsAllReviewed =
                  (validationApplicable || isInvestment)
                  && statements.length > 0
                  && statements.every(statementReviewOk);
                const accountBalanceTip = validationApplicable
                  ? (allStatementsBalancesReconciled
                    ? 'All statements under this account have balances reconciled'
                    : 'Some statements under this account are not reconciled')
                  : isInvestment
                    ? (allStatementsBalancesReconciled
                      ? 'All statements with cash anchors have cash reconciled'
                      : 'Some investment statements need cash reconciliation')
                    : 'Validation not applicable for this account type yet';
                const accountReviewTip = (validationApplicable || isInvestment)
                  ? (allStatementsAllReviewed
                    ? 'All statements under this account have been reviewed'
                    : 'Some statements under this account still need review')
                  : 'Validation not applicable for this account type yet';
                const accountBalanceIconActive =
                  (validationApplicable || isInvestment) && allStatementsBalancesReconciled;
                return (
                <details
                  key={acc.id}
                  className="data-editor-account-block"
                  open={expandedAccountIds.includes(acc.id)}
                  onToggle={(e) => {
                    const isOpen = e.currentTarget.open;
                    setExpandedAccountIds((prev) => {
                      const set = new Set(prev);
                      if (isOpen) set.add(acc.id);
                      else set.delete(acc.id);
                      return Array.from(set);
                    });
                  }}
                >
                  <summary className="data-editor-account-header">
                    <input
                      type="checkbox"
                      className="data-editor-statement-checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked; }}
                      onChange={(e) => { e.stopPropagation(); toggleAccountStatements(acc); }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select all statements for ${acc.name}`}
                    />
                    <ChevronDown size={18} className="data-editor-account-chevron" aria-hidden />
                    <span className="data-editor-account-name">{acc.name}</span>
                    <span className="data-editor-account-type">{acc.account_type}</span>
                    <span className="data-editor-account-validation-icons">
                      <span
                        className={`data-editor-statement-validation-icon${accountBalanceIconActive ? ' is-active' : ''}`}
                        title={accountBalanceTip}
                        aria-label={accountBalanceTip}
                      >
                        <Scale size={14} />
                      </span>
                      <span
                        className={`data-editor-statement-validation-icon${((validationApplicable || isInvestment) && allStatementsAllReviewed) ? ' is-active' : ''}`}
                        title={accountReviewTip}
                        aria-label={accountReviewTip}
                      >
                        <ClipboardCheck size={14} />
                      </span>
                    </span>
                    <span className="data-editor-account-statement-count">
                      {(acc.statements || []).length} statement{(acc.statements || []).length === 1 ? '' : 's'}
                    </span>
                  </summary>
                  <ul className="data-editor-statements">
                    {(acc.statements || []).map((s) => (
                      <li key={s.id} className={`data-editor-statement-item${selectedStatementIds.has(s.id) ? ' data-editor-statement-selected' : ''}`}>
                        {(() => {
                          const {
                            applicable,
                            cashApplicable,
                            cashBalancesReconciled,
                            balancesReconciled,
                            balanceIconActive,
                            allReviewed,
                          } = getStatementValidation(s);
                          const balanceTip = applicable
                            ? (balancesReconciled ? 'Balances reconcile: opening + transactions = closing' : 'Balances not reconciled yet')
                            : cashApplicable
                              ? (cashBalancesReconciled ? 'Cash reconciled: opening cash + transactions = closing cash' : 'Cash balances not reconciled')
                              : accountType === 'investment'
                                ? 'No period cash totals on statement — cash reconciliation skipped'
                                : 'Validation not applicable for this account type yet';
                          const reviewTip = (applicable || accountType === 'investment')
                            ? (allReviewed ? 'All transactions reviewed' : 'Some transactions still need review')
                            : 'Validation not applicable for this account type yet';
                          return (
                        <div className="data-editor-statement-info">
                          <input
                            type="checkbox"
                            className="data-editor-statement-checkbox"
                            checked={selectedStatementIds.has(s.id)}
                            onChange={() => toggleStatementSelected(s.id)}
                            aria-label={`Select ${s.filename}`}
                          />
                          <FileText size={20} strokeWidth={1.5} />
                          <span className="data-editor-statement-filename">{s.filename}</span>
                          <span className="data-editor-statement-meta">
                            {s.start_date && s.end_date
                              ? `${formatDate(s.start_date)} – ${formatDate(s.end_date)}`
                              : (s.transactions?.length ?? 0) > 0
                                ? `${s.transactions.length} transactions`
                                : 'Balance / summary (no transaction list)'}
                          </span>
                          <span className="data-editor-statement-validation-icons">
                            <span className={`data-editor-statement-validation-icon${balanceIconActive ? ' is-active' : ''}`} title={balanceTip} aria-label={balanceTip}>
                              <Scale size={14} />
                            </span>
                            <span className={`data-editor-statement-validation-icon${allReviewed ? ' is-active' : ''}`} title={reviewTip} aria-label={reviewTip}>
                              <ClipboardCheck size={14} />
                            </span>
                          </span>
                          {Array.isArray(s.balance_pairs) && s.balance_pairs.length > 0 && (
                            <span className="data-editor-statement-balances">
                              {s.balance_pairs.map((bp) => (
                                <span key={bp.currency} className="data-editor-balance-pair">
                                  [{formatCurrency(bp.opening, bp.currency)}&nbsp;–&nbsp;{formatCurrency(bp.closing, bp.currency)}]
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                          );
                        })()}
                        <button
                          onClick={() => handleDeleteStatement(s)}
                          disabled={deletingId === s.id}
                          className="data-editor-btn-remove"
                          aria-label={`Remove ${s.filename}`}
                        >
                          <Trash2 size={18} /> {deletingId === s.id ? 'Removing...' : 'Remove'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Transactions Table */}
      <section className="data-editor-transactions">
        <div className="data-editor-transactions-header">
          <h2 className="data-editor-section-title">
            Transactions <span className="data-editor-section-count">({displayTransactions.length})</span>
          </h2>
          <label className="data-editor-toggle-needs-review">
            <input
              type="checkbox"
              checked={showOnlyNeedsReview}
              onChange={(e) => {
                const checked = e.target.checked;
                setShowOnlyNeedsReview(checked);
                if (!checked) setStickyReviewedIds([]);
              }}
            />
            <span>Show only Needs Review</span>
          </label>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="data-editor-clear-filters-btn" aria-label="Clear all filters">
              Clear Filters
            </button>
          )}
        </div>
        <DataEditorTable
          data={displayTransactions}
          isLoading={loading}
          editingTransactionId={editingTransactionId}
          setEditingTransactionId={setEditingTransactionId}
          editingTagsTransactionId={editingTagsTransactionId}
          setEditingTagsTransactionId={setEditingTagsTransactionId}
          categorySelectRef={categorySelectRef}
          showOnlyNeedsReview={showOnlyNeedsReview}
          stickyReviewedIds={stickyReviewedIds}
          expandedTransferIds={expandedTransferIds}
          setExpandedTransferIds={setExpandedTransferIds}
          unlinkingSelfTransferId={unlinkingSelfTransferId}
          markingReviewedId={markingReviewedId}
          pendingBulkAction={pendingBulkAction}
          bulkUpdating={bulkUpdating}
          categories={categories}
          availableTags={availableTags}
          applyCategory={applyCategory}
          applyTags={applyTags}
          handleCategoryKeyDown={handleCategoryKeyDown}
          handleTagCreate={handleTagCreate}
          handleBulkUpdateYes={handleBulkUpdateYes}
          handleBulkUpdateNo={handleBulkUpdateNo}
          markTransactionReviewed={markTransactionReviewed}
          unlinkSelfTransferPair={unlinkSelfTransferPair}
          getTransferMatchText={getTransferMatchText}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
          activeFilterColumn={activeFilterColumn}
          setActiveFilterColumn={setActiveFilterColumn}
          filterDateFrom={filterDateFrom}
          setFilterDateFrom={setFilterDateFrom}
          filterDateTo={filterDateTo}
          setFilterDateTo={setFilterDateTo}
          filterDescription={filterDescription}
          setFilterDescription={setFilterDescription}
          filterAmountMin={filterAmountMin}
          setFilterAmountMin={setFilterAmountMin}
          filterAmountMax={filterAmountMax}
          setFilterAmountMax={setFilterAmountMax}
          filterCategories={filterCategories}
          setFilterCategories={setFilterCategories}
          filterTags={filterTags}
          setFilterTags={setFilterTags}
          dateSortOrder={dateSortOrder}
          setDateSortOrder={setDateSortOrder}
          isDateFilterActive={isDateFilterActive}
          isDescriptionFilterActive={isDescriptionFilterActive}
          isAmountFilterActive={isAmountFilterActive}
          isCategoryFilterActive={isCategoryFilterActive}
          isTagsFilterActive={isTagsFilterActive}
        />
      </section>

      {showUploadModal && (
        <UploadStatementModal
          accessToken={token}
          onClose={() => setShowUploadModal(false)}
          onSuccess={onUploadSuccess}
          onStartUpload={(promise) =>
            startUpload(promise, {
              onSuccess: onUploadSuccess,
              onError: (err) => setError(uploadErrorMessage(err)),
            })
          }
        />
      )}
      {csvReviewFiles && (
        <CsvReviewModal
          files={csvReviewFiles}
          saving={savingCsvReview}
          onCancel={() => setCsvReviewFiles(null)}
          onConfirm={handleCsvReviewConfirm}
        />
      )}
    </div>
  );
}
