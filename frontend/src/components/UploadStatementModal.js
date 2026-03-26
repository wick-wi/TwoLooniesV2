import React, { useState, useRef } from 'react';
import axios from 'axios';
import { formatStatementUploadError } from '../utils/statementUploadErrors';
import './UploadStatementModal.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';
const MAX_STATEMENTS = 12;
const MAX_STATEMENT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per file

function isSupportedStatementFile(file) {
  // Some browsers may not provide a reliable MIME type; fall back to extension.
  const name = (file?.name || '').toLowerCase();
  if (file?.type === 'application/pdf' || name.endsWith('.pdf')) return true;
  if (file?.type === 'text/csv' || name.endsWith('.csv')) return true;
  return false;
}

export default function UploadStatementModal({ onClose, onSuccess, onStartUpload, accessToken = null }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFileChange = (e) => {
    const chosen = Array.from(e.target.files || []);
    setError(null);

    const invalidType = chosen.filter((f) => !isSupportedStatementFile(f));
    const oversized = chosen.filter((f) => isSupportedStatementFile(f) && f.size > MAX_STATEMENT_FILE_SIZE_BYTES);

    let nextError = null;
    if (invalidType.length) nextError = 'Only PDF or CSV files are accepted.';
    else if (oversized.length) nextError = 'Each file must be up to 5MB.';

    const valid = chosen.filter((f) => isSupportedStatementFile(f) && f.size <= MAX_STATEMENT_FILE_SIZE_BYTES);
    const combined = [...files, ...valid].slice(0, MAX_STATEMENTS);
    if (valid.length + files.length > MAX_STATEMENTS) {
      const maxError = `Maximum ${MAX_STATEMENTS} statements. Only the first ${MAX_STATEMENTS} will be used.`;
      nextError = nextError ? `${nextError} ${maxError}` : maxError;
    }
    if (nextError) setError(nextError);
    setFiles(combined);
    e.target.value = '';
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!files.length) {
      setError('Please select at least one PDF or CSV file.');
      return;
    }
    setError(null);
    const formData = new FormData();
    files.forEach((file) => formData.append('statements', file));
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    const promise = axios
      .post(`${API_BASE}/api/upload_statement`, formData, { headers })
      .then((res) => {
        if (res.data.error) throw new Error(res.data.error);
        return res.data;
      });

    if (onStartUpload) {
      onStartUpload(promise);
      onClose();
      return;
    }

    setLoading(true);
    promise
      .then((data) => {
        onSuccess?.(data);
      })
      .catch((err) => {
        setError(formatStatementUploadError(err));
      })
      .finally(() => setLoading(false));
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content modal-content-wide">
        <div className="modal-header">
          <h2>Upload Statements</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-hint">
              Select up to {MAX_STATEMENTS} bank statement files (PDF or CSV). Each file must be up to 5MB.
            </p>
            <div className="file-input-wrapper">
              <input
                ref={inputRef}
                id="statement-file"
                type="file"
                accept=".pdf,.csv"
                multiple
                onChange={handleFileChange}
                className="file-input"
                aria-label="Choose statement files"
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
            <p className="modal-upload-disclaimer">
              Parsed amounts and categories are for your reference only and are not tax or investment
              advice. See our{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                Terms
              </a>
              .
            </p>
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
