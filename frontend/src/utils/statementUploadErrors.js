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
