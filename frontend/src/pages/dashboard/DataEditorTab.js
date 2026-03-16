import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { useAnalysis } from '../../context/AnalysisContext';
import { useUpload } from '../../context/UploadContext';
import UploadStatementModal from '../../components/UploadStatementModal';
import TransactionTagInput from '../../components/TransactionTagInput';
import { FileText, Trash2, RefreshCw, Plus, Landmark, Upload, Sparkles, X, Filter } from 'lucide-react';
import Select from 'react-select';
import { supabase } from '../../lib/supabase';
import './DataEditorTab.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

const filterSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 32,
    background: 'rgba(15, 23, 42, 0.9)',
    borderColor: state.isFocused ? '#f97316' : 'rgba(255,255,255,0.2)',
    boxShadow: state.isFocused ? '0 0 0 2px rgba(249,115,22,0.25)' : 'none',
    fontSize: '0.85rem',
    cursor: 'pointer',
  }),
  menu: (base) => ({
    ...base,
    background: 'rgba(15, 23, 42, 0.98)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    zIndex: 50,
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.85rem',
    background: state.isFocused ? 'rgba(251,191,36,0.15)' : 'transparent',
    color: state.isFocused ? '#fbbf24' : '#e2e8f0',
    cursor: 'pointer',
  }),
  multiValue: (base) => ({ ...base, background: 'rgba(251,191,36,0.18)', borderRadius: 4 }),
  multiValueLabel: (base) => ({ ...base, color: '#fbbf24', fontSize: '0.8rem' }),
  input: (base) => ({ ...base, color: '#e2e8f0', fontSize: '0.85rem' }),
  placeholder: (base) => ({ ...base, color: '#64748b' }),
};

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
  return { id: tx.id ?? tx.transaction_id ?? index, date, description, amount, category, needs_review, tags };
}

function uploadErrorMessage(err) {
  const detail = err.response?.data?.detail;
  const errBody = err.response?.data?.error;
  let msg = errBody
    || (Array.isArray(detail) ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ') : detail)
    || (typeof detail === 'string' ? detail : null)
    || err.message
    || 'Upload failed.';
  if (err.response?.status === 500 && !errBody && !detail) {
    msg = 'Server error (500). Make sure the API backend is running (e.g. port 8000) and try again.';
  }
  return msg;
}

export default function DataEditorTab() {
  const navigate = useNavigate();
  const { isAuthenticated, getAccessToken, user, loading: authLoading } = useAuth();
  const { transactions: contextTx, setAnalysisData, clearAnalysis, analysis, accounts, source, accessToken, itemId, files } = useAnalysis();
  const { startUpload } = useUpload();
  const [statements, setStatements] = useState([]);
  const [accountsWithStatements, setAccountsWithStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [rerunning, setRerunning] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [categorizeSuccess, setCategorizeSuccess] = useState(null);
  const [linkToken, setLinkToken] = useState(null);
  const [linkTokenError, setLinkTokenError] = useState(null);
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

  // Column filter state
  const [filterDescription, setFilterDescription] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterAmountMin, setFilterAmountMin] = useState('');
  const [filterAmountMax, setFilterAmountMax] = useState('');
  const [filterCategories, setFilterCategories] = useState([]);
  const [filterTags, setFilterTags] = useState([]);
  const [activeFilterColumn, setActiveFilterColumn] = useState(null);

  const token = getAccessToken?.();

  const fetchLinkToken = useCallback(async () => {
    setLinkTokenError(null);
    try {
      const res = await axios.post(`${API_BASE}/api/create_link_token`);
      setLinkToken(res.data.link_token);
    } catch (err) {
      console.error('Link token error:', err);
      const msg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        err.message ||
        'Could not connect to bank linking service.';
      setLinkTokenError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }, []);

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
        const exchangeRes = await axios.post(`${API_BASE}/api/exchange_public_token`, { public_token });
        const access_token = exchangeRes.data?.access_token;
        const item_id = exchangeRes.data?.item_id;
        if (!access_token) throw new Error('No access token returned');
        const txRes = await axios.post(`${API_BASE}/api/transactions`, { access_token });
        if (txRes.data.error) throw new Error(txRes.data.error);
        const analysisData = { ...txRes.data, access_token, item_id };
        setAnalysisData(analysisData);
        await axios.post(
          `${API_BASE}/api/save_analysis`,
          {
            source: 'plaid',
            summary: txRes.data.analysis || {},
            access_token,
            item_id: item_id || 'unknown',
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        navigate('/dashboard');
      } catch (err) {
        console.error('Plaid flow error:', err);
        setError(err.response?.data?.error || err.message || 'Something went wrong.');
      }
    },
    [token, setAnalysisData, navigate]
  );

  const fetchUserData = useCallback(async (options = {}) => {
    if (!token) return;
    const { background } = options;
    if (!background) setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/user_data`, {
        headers: { Authorization: `Bearer ${token}` },
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
      setError(err.response?.data?.detail || err.message || 'Failed to load data');
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
  }, [isAuthenticated, authLoading, fetchUserData, navigate]);

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
      await axios.delete(`${API_BASE}/api/statements/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Refetch so we get correct accounts_with_statements (delete response doesn't include it)
      await fetchUserData({ background: true });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to delete');
    } finally {
      setDeletingId(null);
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
      });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to rerun');
    } finally {
      setRerunning(false);
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
    if (!token || !data.files?.length) {
      setAnalysisData(data);
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

  const applyCategory = useCallback(
    async (transactionId, newCategory) => {
      if (!token || !newCategory?.trim()) return;
      const previous = {
        transactions: contextTx,
        analysis,
        accounts,
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
    [token, contextTx, analysis, accounts, source, accessToken, itemId, files, setAnalysisData, showOnlyNeedsReview]
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
    [token, contextTx, analysis, accounts, source, accessToken, itemId, files, setAnalysisData, pendingBulkAction]
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
  }, [token, pendingBulkAction, contextTx, setAnalysisData, analysis, accounts, source, accessToken, itemId, files, fetchUserData]);

  const handleBulkUpdateNo = useCallback(() => {
    setPendingBulkAction(null);
  }, []);

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(value);

  const formatDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    return isNaN(date.getTime()) ? d : date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const displayTransactionsRaw =
    contextTx?.length > 0
      ? contextTx
          .map((t, i) => normalizeTransaction(t, i))
          .filter(Boolean)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      : [];
  const afterNeedsReview = showOnlyNeedsReview
    ? displayTransactionsRaw.filter(
        (tx) => tx.needs_review === true || stickyReviewedIds.includes(tx.id)
      )
    : displayTransactionsRaw;

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
  ]);

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
            <button onClick={fetchLinkToken} className="data-editor-btn data-editor-btn-secondary">
              Retry Connect Bank
            </button>
          ) : (
            <button disabled className="data-editor-btn data-editor-btn-secondary opacity-60">
              Loading...
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
                <button onClick={fetchLinkToken} className="data-editor-btn data-editor-btn-secondary">
                  Retry Connect Bank
                </button>
              ) : (
                <button disabled className="data-editor-btn data-editor-btn-secondary opacity-60">
                  Loading Plaid...
                </button>
              )}
              <button onClick={() => setShowUploadModal(true)} className="data-editor-btn data-editor-btn-primary">
                <Plus size={18} /> Upload Statement
              </button>
            </div>
            {linkTokenError && <p className="data-editor-empty-error">{linkTokenError}</p>}
          </div>
        ) : (
          <div className="glass-card data-editor-accounts">
            {accountsWithStatements.map((acc) => (
              <div key={acc.id} className="data-editor-account-block">
                <div className="data-editor-account-header">
                  <span className="data-editor-account-name">{acc.name}</span>
                  {acc.account_number && (
                    <span className="data-editor-account-number">••••{acc.account_number.slice(-4)}</span>
                  )}
                  <span className="data-editor-account-type">{acc.account_type}</span>
                  {acc.provider && <span className="data-editor-account-provider">{acc.provider}</span>}
                </div>
                <ul className="data-editor-statements">
                  {(acc.statements || []).map((s) => (
                    <li key={s.id} className="data-editor-statement-item">
                      <div className="data-editor-statement-info">
                        <FileText size={20} strokeWidth={1.5} />
                        <span className="data-editor-statement-filename">{s.filename}</span>
                        <span className="data-editor-statement-meta">
                          {s.start_date && s.end_date
                            ? `${formatDate(s.start_date)} – ${formatDate(s.end_date)}`
                            : (s.transactions?.length ?? 0) > 0
                              ? `${s.transactions.length} transactions`
                              : 'Balance / summary (no transaction list)'}
                        </span>
                      </div>
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
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Transactions Table */}
      <section className="data-editor-transactions">
        <div className="data-editor-transactions-header">
          <h2 className="data-editor-section-title">Recent Transactions</h2>
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
        {loading ? (
          <div className="glass-card data-editor-loading">Loading your data...</div>
        ) : (
          <div className="glass-card data-editor-table-wrapper">
            <div className="data-editor-table-scroll">
              <table className="data-editor-table">
                <thead>
                  <tr>
                    <th className={isDateFilterActive ? 'data-editor-th-filter-active' : ''}>
                      <button
                        type="button"
                        className="data-editor-th-filter-btn"
                        onClick={() => setActiveFilterColumn((c) => (c === 'date' ? null : 'date'))}
                        aria-expanded={activeFilterColumn === 'date'}
                        aria-label="Filter by date"
                      >
                        Date
                        {isDateFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
                      </button>
                    </th>
                    <th className={isDescriptionFilterActive ? 'data-editor-th-filter-active' : ''}>
                      <button
                        type="button"
                        className="data-editor-th-filter-btn"
                        onClick={() => setActiveFilterColumn((c) => (c === 'description' ? null : 'description'))}
                        aria-expanded={activeFilterColumn === 'description'}
                        aria-label="Filter by description"
                      >
                        Description
                        {isDescriptionFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
                      </button>
                    </th>
                    <th className={`text-right ${isAmountFilterActive ? 'data-editor-th-filter-active' : ''}`}>
                      <button
                        type="button"
                        className="data-editor-th-filter-btn data-editor-th-filter-btn-right"
                        onClick={() => setActiveFilterColumn((c) => (c === 'amount' ? null : 'amount'))}
                        aria-expanded={activeFilterColumn === 'amount'}
                        aria-label="Filter by amount"
                      >
                        Amount
                        {isAmountFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
                      </button>
                    </th>
                    <th className={isCategoryFilterActive ? 'data-editor-th-filter-active' : ''}>
                      <button
                        type="button"
                        className="data-editor-th-filter-btn"
                        onClick={() => setActiveFilterColumn((c) => (c === 'category' ? null : 'category'))}
                        aria-expanded={activeFilterColumn === 'category'}
                        aria-label="Filter by category"
                      >
                        Category
                        {isCategoryFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
                      </button>
                    </th>
                    <th className={isTagsFilterActive ? 'data-editor-th-filter-active' : ''}>
                      <button
                        type="button"
                        className="data-editor-th-filter-btn"
                        onClick={() => setActiveFilterColumn((c) => (c === 'tags' ? null : 'tags'))}
                        aria-expanded={activeFilterColumn === 'tags'}
                        aria-label="Filter by tags"
                      >
                        Tags
                        {isTagsFilterActive && <Filter size={14} className="data-editor-th-filter-icon" aria-hidden />}
                      </button>
                    </th>
                    <th className="data-editor-actions-col">Actions</th>
                  </tr>
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
                          <button type="button" className="data-editor-filter-clear-col" onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }} aria-label="Clear date filter">
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
                          <button type="button" className="data-editor-filter-clear-col" onClick={() => setFilterDescription('')} aria-label="Clear description filter">
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className={`text-right ${activeFilterColumn === 'amount' ? 'data-editor-filter-cell-active' : ''}`}>
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
                          <button type="button" className="data-editor-filter-clear-col" onClick={() => { setFilterAmountMin(''); setFilterAmountMax(''); }} aria-label="Clear amount filter">
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
                            options={categories.map((c) => ({ value: c.name, label: c.name }))}
                            onChange={(selected) => setFilterCategories((selected || []).map((o) => o.value))}
                            styles={filterSelectStyles}
                            classNamePrefix="data-editor-filter-select"
                            menuPortalTarget={document.body}
                          />
                          <button type="button" className="data-editor-filter-clear-col" onClick={() => setFilterCategories([])} aria-label="Clear category filter">
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
                            onChange={(selected) => setFilterTags((selected || []).map((o) => o.value))}
                            styles={filterSelectStyles}
                            classNamePrefix="data-editor-filter-select"
                            menuPortalTarget={document.body}
                          />
                          <button type="button" className="data-editor-filter-clear-col" onClick={() => setFilterTags([])} aria-label="Clear tags filter">
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="data-editor-filter-row-actions" />
                  </tr>
                </thead>
                <tbody>
                  {displayTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="data-editor-table-empty">
                        No transactions yet. Connect your bank or upload statements to see them here.
                      </td>
                    </tr>
                  ) : (
                    displayTransactions.map((tx) => {
                      const isProcessedSticky =
                        showOnlyNeedsReview && !tx.needs_review && stickyReviewedIds.includes(tx.id);
                      return (
                      <React.Fragment key={tx.id}>
                        <tr
                          className={[
                            tx.needs_review ? 'data-editor-row-needs-review' : '',
                            isProcessedSticky ? 'data-editor-row-processed' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                        <td>{formatDate(tx.date)}</td>
                        <td>{tx.description}</td>
                        <td className={`text-right ${tx.amount >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                          {formatCurrency(tx.amount)}
                        </td>
                        <td
                          className={editingTransactionId === tx.id ? 'data-editor-cell-edit' : ''}
                          onClick={() => editingTransactionId !== tx.id && setEditingTransactionId(tx.id)}
                        >
                          {editingTransactionId === tx.id ? (
                            <select
                              ref={categorySelectRef}
                              className="data-editor-category-select"
                              value={tx.category || ''}
                              onChange={(e) => applyCategory(tx.id, e.target.value)}
                              onKeyDown={(e) => handleCategoryKeyDown(e, tx.id)}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                            >
                              <option value="">—</option>
                              {categories.map((c) => (
                                <option key={c.id || c.name} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              {tx.needs_review && <span className="data-editor-needs-review-dot" aria-hidden />}
                              {tx.category || '—'}
                            </>
                          )}
                        </td>
                        <td
                          className={editingTagsTransactionId === tx.id ? 'data-editor-cell-edit data-editor-tags-cell-edit' : 'data-editor-tags-cell'}
                          onClick={() => editingTagsTransactionId !== tx.id && setEditingTagsTransactionId(tx.id)}
                        >
                          {editingTagsTransactionId === tx.id ? (
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
                                <span key={tag} className="data-editor-tag-chip">{tag}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="data-editor-tags-empty">—</span>
                          )}
                        </td>
                        <td className="data-editor-actions-cell">
                          {pendingBulkAction && pendingBulkAction.transactionId === tx.id && (
                            <div className="data-editor-bulk-inline">
                              <span
                                className="data-editor-bulk-inline-icon"
                                style={{ pointerEvents: bulkUpdating ? 'none' : undefined }}
                                title={
                                  (() => {
                                    const parts = [];
                                    if (tx.category) parts.push(tx.category);
                                    if (tx.tags?.length) parts.push(tx.tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' '));
                                    const applyTo = parts.length ? `Apply ${parts.join(' and ')} to ` : 'Apply to ';
                                    return `${applyTo}${pendingBulkAction.count} similar transaction${pendingBulkAction.count !== 1 ? 's' : ''}`;
                                  })()
                                }
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
                                onClick={(e) => { e.stopPropagation(); handleBulkUpdateNo(); }}
                                disabled={bulkUpdating}
                                aria-label="Dismiss bulk action"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      </React.Fragment>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {showUploadModal && (
        <UploadStatementModal
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
    </div>
  );
}
