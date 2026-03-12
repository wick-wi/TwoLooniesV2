import React, { createContext, useContext, useState } from 'react';
import './UploadContext.css';

const UploadContext = createContext(null);

export function UploadProvider({ children }) {
  const [uploadInProgress, setUploadInProgress] = useState(false);

  const startUpload = (promise, { onSuccess, onError } = {}) => {
    setUploadInProgress(true);
    promise
      .then((data) => {
        onSuccess?.(data);
      })
      .catch((err) => {
        onError?.(err);
      })
      .finally(() => {
        setUploadInProgress(false);
      });
  };

  const value = { uploadInProgress, startUpload };

  return (
    <UploadContext.Provider value={value}>
      {children}
      {uploadInProgress && (
        <div className="upload-indicator" aria-live="polite" aria-label="Uploading statement">
          <div className="upload-indicator-loonie" aria-hidden />
          <span className="upload-indicator-label">Uploading…</span>
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
