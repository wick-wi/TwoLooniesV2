import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import './UploadContext.css';

const UploadContext = createContext(null);

const API_BASE = (process.env.REACT_APP_API_URL ?? '').replace(/\/$/, '');
const JOB_ID_KEY = 'twoLoonies_jobId';
const JOB_SECRET_KEY = 'twoLoonies_jobPollSecret';
const POLL_HEADER = 'X-Statement-Job-Secret';

function apiUrl(path) {
  if (!path.startsWith('/')) return `${API_BASE}/${path}`;
  return API_BASE ? `${API_BASE}${path}` : path;
}

export function UploadProvider({ children }) {
  const [jobId, setJobId] = useState(() => sessionStorage.getItem(JOB_ID_KEY) || null);

  const [uploadState, setUploadState] = useState({
    active: !!sessionStorage.getItem(JOB_ID_KEY),
    message: 'Restoring upload session...',
    current: 0,
    total: 0,
    isError: false,
  });

  const callbacksRef = useRef({ onSuccess: null, onError: null });
  const skippedDuplicatesRef = useRef([]);

  const clearJobSession = useCallback(() => {
    sessionStorage.removeItem(JOB_ID_KEY);
    sessionStorage.removeItem(JOB_SECRET_KEY);
  }, []);

  const startUpload = async (uploadPromise, { onSuccess, onError } = {}) => {
    clearJobSession();
    setJobId(null);
    skippedDuplicatesRef.current = [];

    callbacksRef.current = { onSuccess, onError };
    setUploadState({ active: true, message: 'Preparing your files...', current: 0, total: 0, isError: false });

    try {
      const response = await uploadPromise;

      const skipped = response?.skipped_duplicates || response?.data?.skipped_duplicates;
      if (Array.isArray(skipped) && skipped.length) {
        skippedDuplicatesRef.current = skipped;
      }

      const actualJobId = response?.job_id || response?.data?.job_id;
      const pollSecret = response?.poll_secret ?? response?.data?.poll_secret;

      if (actualJobId) {
        if (pollSecret) {
          sessionStorage.setItem(JOB_SECRET_KEY, pollSecret);
        }
        setJobId(actualJobId);
      } else if (response && (response.error || response?.data?.error)) {
        throw new Error(response.error || response.data.error);
      } else {
        onSuccess?.(response);
        setUploadState({ active: false, isError: false });
      }
    } catch (err) {
      handleError(err, 'Failed to start upload.');
    }
  };

  const handleError = useCallback((err, fallbackMessage) => {
    console.error('Upload Error:', err);
    callbacksRef.current.onError?.(err);
    setUploadState((prev) => ({
      ...prev,
      active: true,
      isError: true,
      message: err.message || fallbackMessage,
    }));

    setTimeout(() => {
      setJobId(null);
      clearJobSession();
      setUploadState((prev) => ({ ...prev, active: false }));
    }, 4000);
  }, [clearJobSession]);

  useEffect(() => {
    if (!jobId) {
      clearJobSession();
      return;
    }

    sessionStorage.setItem(JOB_ID_KEY, jobId);
    let pollInterval;

    const pollHeaders = () => {
      const secret = sessionStorage.getItem(JOB_SECRET_KEY);
      const h = {};
      if (secret) {
        h[POLL_HEADER] = secret;
      }
      return h;
    };

    const checkStatus = async () => {
      try {
        const statusRes = await fetch(apiUrl(`/api/upload_statement_status/${jobId}`), {
          headers: pollHeaders(),
        });
        if (!statusRes.ok) throw new Error('Upload session expired or lost.');

        const data = await statusRes.json();

        setUploadState((prev) => ({
          ...prev,
          active: true,
          message: data.message || 'Processing...',
          current: data.current_file || 0,
          total: data.total_files || 0,
        }));

        if (data.status === 'complete') {
          clearInterval(pollInterval);

          const resultRes = await fetch(apiUrl(`/api/upload_statement_result/${jobId}`), {
            headers: pollHeaders(),
          });
          if (!resultRes.ok) throw new Error('Failed to fetch final results.');

          const resultData = await resultRes.json();
          const merged = {
            ...resultData,
            ...(skippedDuplicatesRef.current.length
              ? { skipped_duplicates: skippedDuplicatesRef.current }
              : {}),
          };
          skippedDuplicatesRef.current = [];
          callbacksRef.current.onSuccess?.(merged);

          setUploadState((prev) => ({ ...prev, message: data.message || 'All done!', isError: false }));
          setTimeout(() => {
            setJobId(null);
            clearJobSession();
            setUploadState((prev) => ({ ...prev, active: false }));
          }, 2500);
        }

        if (data.status === 'error') {
          throw new Error(data.message || 'Processing failed on the server.');
        }
      } catch (err) {
        clearInterval(pollInterval);
        handleError(err, 'Lost connection to processing server.');
      }
    };

    pollInterval = setInterval(checkStatus, 750);
    checkStatus();

    return () => clearInterval(pollInterval);
  }, [jobId, handleError, clearJobSession]);

  const value = {
    uploadInProgress: uploadState.active,
    startUpload,
    uploadState,
  };

  return (
    <UploadContext.Provider value={value}>
      {children}
      {uploadState.active && (
        <div
          className={`upload-indicator ${uploadState.isError ? 'upload-error' : ''}`}
          aria-live="polite"
          aria-label="Uploading statement"
        >
          {!uploadState.isError && <div className="upload-indicator-loonie" aria-hidden />}
          <span className="upload-indicator-label">{uploadState.message}</span>
        </div>
      )}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) {
    throw new Error('useUpload must be used within UploadProvider');
  }
  return ctx;
}
