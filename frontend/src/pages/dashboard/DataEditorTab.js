import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { useAnalysis } from '../../context/AnalysisContext';
import UploadStatementModal from '../../components/UploadStatementModal';
import { FileText, Trash2, RefreshCw, Plus, Landmark, Upload, Sparkles } from 'lucide-react';
import { mockData } from '../../data/mockData';
import { supabase } from '../../lib/supabase';
import './DataEditorTab.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

function PlaidConnectButton({ linkToken, onSuccess, className, children }) {
  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });
  return (
    <button type="button" onClick={() => open()} disabled={!ready} className={className}>
      {children}
    </button>
  );
}

/**
 * Normalize API transaction to { date, description, amount, category }
 */
function normalizeTransaction(tx, index) {
  if (!tx) return null;
  const date = tx.date ?? tx.transaction_date ?? tx.posted_at ?? '';
  const description = tx.name ?? tx.merchant_name ?? tx.description ?? tx.pending_transaction_id ?? 'Unknown';
  const amount = tx.amount ?? tx.authorized_amount ?? 0;
  const category = Array.isArray(tx.category)
    ? tx.category?.join(', ') ?? tx.personal_finance_category?.primary ?? ''
    : tx.category ?? tx.personal_finance_category?.primary ?? '';
  return { id: tx.transaction_id ?? tx.id ?? index, date, description, amount, category };
}

export default function DataEditorTab() {
  const navigate = useNavigate();
  const { isAuthenticated, getAccessToken, user, loading: authLoading } = useAuth();
  const { transactions: contextTx, setAnalysisData, clearAnalysis } = useAnalysis();
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [rerunning, setRerunning] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [linkToken, setLinkToken] = useState(null);
  const [linkTokenError, setLinkTokenError] = useState(null);

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

  const fetchUserData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/user_data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStatements(res.data.statements || []);
      setAnalysisData(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load data');
      setStatements([]);
      clearAnalysis?.();
    } finally {
      setLoading(false);
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
      const res = await axios.delete(`${API_BASE}/api/statements/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStatements(res.data.statements || []);
      setAnalysisData({
        transactions: res.data.transactions,
        analysis: res.data.analysis,
        source: 'pdf',
      });
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
    setCategorizing(true);
    setError(null);
    try {
      let totalUpdated = 0;
      const maxRounds = 20;
      for (let round = 0; round < maxRounds; round++) {
        const { data, error: fnError } = await supabase.functions.invoke('categorize-transaction', {
          body: { user_id: user.id },
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
      await fetchUserData();
    } catch (err) {
      setError(err.message || 'Failed to categorize transactions');
    } finally {
      setCategorizing(false);
    }
  };

  const onUploadSuccess = async (data) => {
    if (!token || !data.files?.length) {
      setAnalysisData(data);
      setShowUploadModal(false);
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/save_statements`, { statements: data.files }, { headers: { Authorization: `Bearer ${token}` } });
      setShowUploadModal(false);
      fetchUserData();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to save statements');
      setAnalysisData(data);
      setShowUploadModal(false);
    }
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(value);

  const formatDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    return isNaN(date.getTime()) ? d : date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const displayTransactions =
    contextTx?.length > 0
      ? contextTx.map((t, i) => normalizeTransaction(t, i)).filter(Boolean)
      : mockData.recentTransactions;

  return (
    <div className="data-editor-tab">
      {error && (
        <div className="data-editor-error">
          {error}
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
          <ul className="glass-card data-editor-statements">
            {statements.map((s) => (
              <li key={s.id} className="data-editor-statement-item">
                <div className="data-editor-statement-info">
                  <FileText size={20} strokeWidth={1.5} />
                  <span className="data-editor-statement-filename">{s.filename}</span>
                  <span className="data-editor-statement-meta">{(s.transactions?.length ?? 0)} transactions</span>
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
        )}
      </section>

      {/* Transactions Table */}
      <section className="data-editor-transactions">
        <h2 className="data-editor-section-title">Recent Transactions</h2>
        {loading ? (
          <div className="glass-card data-editor-loading">Loading your data...</div>
        ) : (
          <div className="glass-card data-editor-table-wrapper">
            <div className="data-editor-table-scroll">
              <table className="data-editor-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="text-right">Amount</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {displayTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>{formatDate(tx.date)}</td>
                      <td>{tx.description}</td>
                      <td className={`text-right ${tx.amount >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                        {formatCurrency(tx.amount)}
                      </td>
                      <td>{tx.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {showUploadModal && (
        <UploadStatementModal onClose={() => setShowUploadModal(false)} onSuccess={onUploadSuccess} />
      )}
    </div>
  );
}
