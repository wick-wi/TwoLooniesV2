import React, { useState, useRef } from 'react';
import axios from 'axios';
import './UploadStatementModal.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000';
const MAX_STATEMENTS = 12;

export default function UploadStatementModal({ onClose, onSuccess }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFileChange = (e) => {
    const chosen = Array.from(e.target.files || []);
    setError(null);
    const valid = chosen.filter((f) => f.type === 'application/pdf');
    const invalid = chosen.filter((f) => f.type !== 'application/pdf');
    if (invalid.length) {
      setError('Only PDF files are accepted.');
    }
    const combined = [...files, ...valid].slice(0, MAX_STATEMENTS);
    if (valid.length + files.length > MAX_STATEMENTS) {
      setError(`Maximum ${MAX_STATEMENTS} statements. Only the first ${MAX_STATEMENTS} will be used.`);
    }
    setFiles(combined);
    e.target.value = '';
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files.length) {
      setError('Please select at least one PDF file.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('statements', file));
      const res = await axios.post(`${API_BASE}/api/upload_statement`, formData);
      if (res.data.error) throw new Error(res.data.error);
      onSuccess(res.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = err.response?.data?.error
        || (Array.isArray(detail) ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ') : detail)
        || err.message
        || 'Upload failed.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content modal-content-wide">
        <div className="modal-header">
          <h2>Upload PDF Statements</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-hint">
              Select up to {MAX_STATEMENTS} bank statement PDFs (e.g. TD, RBC, Scotia).
            </p>
            <div className="file-input-wrapper">
              <input
                ref={inputRef}
                id="statement-file"
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileChange}
                className="file-input"
                aria-label="Choose PDF files"
              />
              <label htmlFor="statement-file" className="file-input-label">
                {files.length ? `Add more (${files.length}/${MAX_STATEMENTS})` : 'Choose Files'}
              </label>
            </div>
            {files.length > 0 && (
              <ul className="file-list">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="file-list-item">
                    <span className="file-list-name">{file.name}</span>
                    <button
                      type="button"
                      className="file-list-remove"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${file.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="modal-error">{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={!files.length || loading} className="btn-primary">
              {loading ? 'Parsing...' : `Upload & Analyze ${files.length} Statement${files.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
