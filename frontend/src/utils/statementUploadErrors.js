/**
 * Axios timeout / no response (API down, wrong host, or macOS localhost → ::1 hang).
 * Returns a string to show the user, or null if a normal HTTP error body should be used.
 */
export function formatApiConnectionError(err, contextLabel = 'Request') {
  const m = (err?.message || '').toLowerCase();
  if (err?.code === 'ECONNABORTED' || m.includes('timeout')) {
    return `${contextLabel} timed out. Start the API (e.g. uvicorn on port 8000) and set REACT_APP_API_URL=http://127.0.0.1:8000 in frontend/.env.local — on macOS, "localhost" can hang trying IPv6.`;
  }
  if (!err?.response) {
    return `${contextLabel}: cannot reach server (${err?.message || 'network error'}). Check the API is running and REACT_APP_API_URL matches it.`;
  }
  return null;
}

/**
 * Human-readable message for /api/upload_statement failures (including 409 duplicate payloads).
 */
export function formatStatementUploadError(err) {
  const detail = err.response?.data?.detail;
  const errBody = err.response?.data?.error;
  const status = err.response?.status;
  if (status === 500 && !errBody && detail == null) {
    return 'Server error (500). Make sure the API backend is running (e.g. port 8000) and try again.';
  }
  if (errBody) return typeof errBody === 'string' ? errBody : JSON.stringify(errBody);
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const msg = detail.message || (status === 409 ? 'These PDFs were already uploaded.' : 'Request failed.');
    const names = detail.duplicate_filenames;
    if (Array.isArray(names) && names.length) {
      return `${msg} ${names.join(', ')}`;
    }
    return msg;
  }
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
  }
  if (typeof detail === 'string') return detail;
  if (err.message) return err.message;
  return 'Upload failed.';
}
