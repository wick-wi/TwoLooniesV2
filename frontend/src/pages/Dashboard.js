import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useAnalysis } from '../context/AnalysisContext';
import UploadStatementModal from '../components/UploadStatementModal';
import { FileText, Trash2, RefreshCw, Plus } from 'lucide-react';
import './Dashboard.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, getAccessToken, signOut, loading: authLoading } = useAuth();
  const { analysis, transactions, setAnalysisData, clearAnalysis } = useAnalysis();
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [rerunning, setRerunning] = useState(false);

  const token = getAccessToken?.();

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
      });
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to rerun');
    } finally {
      setRerunning(false);
    }
  };

  const onUploadSuccess = async (data) => {
    if (!token || !data.files?.length) {
      setAnalysisData(data);
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
            <button onClick={() => navigate('/')} className="btn-header">
              Home
            </button>
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
                <p>No statements yet. Upload PDF bank statements to get started.</p>
                <button onClick={() => setShowUploadModal(true)} className="btn-primary-dash">
                  <Plus size={18} /> Upload Statement
                </button>
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
          onClose={() => setShowUploadModal(false)}
          onSuccess={onUploadSuccess}
        />
      )}
    </div>
  );
}
