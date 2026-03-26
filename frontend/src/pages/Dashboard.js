import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useAnalysis } from '../context/AnalysisContext';
import { useUpload } from '../context/UploadContext';
import UploadStatementModal from '../components/UploadStatementModal';
import CsvReviewModal from '../components/CsvReviewModal';
import { formatApiConnectionError, formatStatementUploadError } from '../utils/statementUploadErrors';
import { FileText, Trash2, RefreshCw, Plus, Landmark, Scale } from 'lucide-react';
import './Dashboard.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';
const API_TIMEOUT_MS = 45_000;

function PlaidConnectButton({ linkToken, onSuccess, className, children }) {
  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });
  return (
    <button
      type="button"
      onClick={() => open()}
      disabled={!ready}
      className={className}
    >
      {children}
    </button>
  );
}

function uploadErrorMessage(err) {
  return formatStatementUploadError(err);
}

function isStatementBalanceReconciled(statement) {
  if (!statement) return false;
  const bankOk = !!statement.validation_applicable && !!statement.balances_reconciled;
  const cashOk = !!statement.cash_validation_applicable && !!statement.cash_balances_reconciled;
  return bankOk || cashOk;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, getAccessToken, signOut, loading: authLoading } = useAuth();
  const { analysis, setAnalysisData, clearAnalysis } = useAnalysis();
  const { startUpload } = useUpload();
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [csvReviewFiles, setCsvReviewFiles] = useState(null);
  const [savingCsvReview, setSavingCsvReview] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [rerunning, setRerunning] = useState(false);
  const [linkToken, setLinkToken] = useState(null);
  const [linkTokenError, setLinkTokenError] = useState(null);
  const [linkTokenLoading, setLinkTokenLoading] = useState(false);
  const [linkTokenReady, setLinkTokenReady] = useState(false);

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

  const onPlaidSuccess = useCallback(async (public_token) => {
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
      navigate('/analysis');
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
  }, [token, setAnalysisData, navigate]);

  const fetchUserData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/user_data`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: API_TIMEOUT_MS,
      });
      setStatements(res.data.statements || []);
      setAnalysisData(res.data);
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
  }, [isAuthenticated, authLoading, token, fetchUserData, navigate]);

  const handleDeleteStatement = async (id) => {
    if (!token) return;
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
        balances: res.data.balances,
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
      const res = await axios.post(`${API_BASE}/api/rerun_analysis`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStatements(res.data.statements || []);
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

  const onUploadSuccess = async (data) => {
    const skipNote =
      data?.skipped_duplicates?.length > 0
        ? `Already in your account (skipped): ${data.skipped_duplicates.map((s) => s.filename).join(', ')}`
        : null;
    if (skipNote) setError(skipNote);
    else setError(null);

    if (!token || !data.files?.length) {
      setAnalysisData(data);
      setShowUploadModal(false);
      return;
    }
    const hasCsvGroups = data.files.some((f) => Array.isArray(f.account_groups) && f.account_groups.length > 0);
    if (hasCsvGroups) {
      setCsvReviewFiles(data.files);
      setShowUploadModal(false);
      return;
    }
    try {
      await axios.post(
        `${API_BASE}/api/save_statements`,
        { statements: data.files },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setShowUploadModal(false);
      fetchUserData();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to save statements');
      setAnalysisData(data);
      setShowUploadModal(false);
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
      fetchUserData();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to save reviewed CSV statements');
    } finally {
      setSavingCsvReview(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    clearAnalysis?.();
    navigate('/');
  };

  if (authLoading || !isAuthenticated) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-loading">Loading...</div>
      </div>
    );
  }

  const categoryEntries = analysis ? Object.entries(analysis.by_category || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) : [];
  const monthEntries = analysis ? Object.entries(analysis.cash_flow_by_month || {}) : [];

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <h1>Your Dashboard</h1>
          <div className="dashboard-actions">
            <button onClick={handleLogout} className="btn-header btn-outline">
              Log out
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="dashboard-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="dashboard-loading">Loading your data...</div>
      ) : (
        <>
          <section className="statements-section">
            <div className="statements-header">
              <h2>Your Statements</h2>
              <div className="statements-actions">
                {linkToken ? (
                  <PlaidConnectButton
                    linkToken={linkToken}
                    onSuccess={onPlaidSuccess}
                    className="btn-plaid-dash"
                  >
                    <Landmark size={18} /> Connect Bank
                  </PlaidConnectButton>
                ) : linkTokenError ? (
                  <button type="button" onClick={fetchLinkToken} className="btn-secondary-dash">
                    Retry Connect Bank
                  </button>
                ) : !linkTokenReady || linkTokenLoading ? (
                  <button type="button" disabled className="btn-secondary-dash opacity-60">
                    Loading...
                  </button>
                ) : (
                  <button type="button" disabled className="btn-secondary-dash opacity-60">
                    Bank link unavailable
                  </button>
                )}
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="btn-primary-dash"
                >
                  <Plus size={18} /> Add Statement
                </button>
                {statements.length > 0 && (
                  <button
                    onClick={handleRerunAnalysis}
                    disabled={rerunning}
                    className="btn-secondary-dash"
                  >
                    <RefreshCw size={18} className={rerunning ? 'spin' : ''} /> {rerunning ? 'Rerunning...' : 'Rerun Analysis'}
                  </button>
                )}
              </div>
            </div>

            {statements.length === 0 ? (
              <div className="statements-empty">
                <FileText size={48} strokeWidth={1} className="statements-empty-icon" />
                <p>No statements yet. Connect your bank or upload PDF statements to get started.</p>
                <div className="statements-empty-actions">
                  {linkToken ? (
                    <PlaidConnectButton
                      linkToken={linkToken}
                      onSuccess={onPlaidSuccess}
                      className="btn-primary-dash"
                    >
                      <Landmark size={18} /> Connect Bank Account
                    </PlaidConnectButton>
                  ) : linkTokenError ? (
                    <button type="button" onClick={fetchLinkToken} className="btn-secondary-dash">
                      Retry Connect Bank
                    </button>
                  ) : !linkTokenReady || linkTokenLoading ? (
                    <button type="button" disabled className="btn-secondary-dash opacity-60">
                      Loading Plaid...
                    </button>
                  ) : (
                    <button type="button" disabled className="btn-secondary-dash opacity-60">
                      Bank link unavailable
                    </button>
                  )}
                  <button onClick={() => setShowUploadModal(true)} className="btn-primary-dash">
                    <Plus size={18} /> Upload Statement
                  </button>
                </div>
                {linkTokenError && (
                  <p className="statements-empty-error">{linkTokenError}</p>
                )}
              </div>
            ) : (
              <ul className="statements-list">
                {statements.map((s) => (
                  <li key={s.id} className="statement-item">
                    <div className="statement-info">
                      <FileText size={20} strokeWidth={1.5} />
                      <span className="statement-filename">{s.filename}</span>
                      <span className="statement-meta">
                        {(s.transactions?.length ?? 0)} transactions
                      </span>
                      <span
                        className={`dashboard-statement-balance-icon${isStatementBalanceReconciled(s) ? ' is-active' : ''}`}
                        title={
                          isStatementBalanceReconciled(s)
                            ? 'Balances reconcile with transactions'
                            : 'Balances not reconciled or not applicable'
                        }
                        aria-label={
                          isStatementBalanceReconciled(s)
                            ? 'Balances reconcile with transactions'
                            : 'Balances not reconciled or not applicable'
                        }
                      >
                        <Scale size={14} />
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteStatement(s.id)}
                      disabled={deletingId === s.id}
                      className="btn-remove"
                      aria-label={`Remove ${s.filename}`}
                    >
                      <Trash2 size={18} />
                      {deletingId === s.id ? ' Removing...' : ' Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {analysis && (
            <section className="analysis-section">
              <h2>Financial Insights</h2>
              <div className="summary-cards">
                <div className="card">
                  <h3>Income</h3>
                  <p className="amount positive">${(analysis.total_income ?? 0).toLocaleString()}</p>
                </div>
                <div className="card">
                  <h3>Expenses</h3>
                  <p className="amount negative">${(analysis.total_expenses ?? 0).toLocaleString()}</p>
                </div>
                <div className="card">
                  <h3>Cash Flow</h3>
                  <p className={`amount ${(analysis.cash_flow ?? 0) >= 0 ? 'positive' : 'negative'}`}>
                    ${(analysis.cash_flow ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {categoryEntries.length > 0 && (
                <div className="insight-block">
                  <h3>Spending by Category</h3>
                  <ul className="category-list">
                    {categoryEntries.slice(0, 10).map(([cat, amt]) => (
                      <li key={cat}>
                        <span className="cat-name">{cat}</span>
                        <span className="cat-amount">${Math.abs(amt).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(analysis.top_merchants?.length ?? 0) > 0 && (
                <div className="insight-block">
                  <h3>Top Merchants</h3>
                  <ul className="merchant-list">
                    {analysis.top_merchants.map((m, i) => (
                      <li key={i}>
                        <span className="merchant-name">{m.name}</span>
                        <span className="merchant-amount">${m.amount?.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {monthEntries.length > 0 && (
                <div className="insight-block">
                  <h3>Cash Flow by Month</h3>
                  <ul className="month-list">
                    {monthEntries.map(([month, amt]) => (
                      <li key={month}>
                        <span className="month-name">{month}</span>
                        <span className={`month-amount ${amt >= 0 ? 'positive' : 'negative'}`}>
                          ${amt?.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}

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
