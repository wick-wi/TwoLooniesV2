import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import './UploadContext.css';

const UploadContext = createContext(null);

export function UploadProvider({ children }) {
  // 1. Initialize jobId from localStorage in case of a page refresh
  const [jobId, setJobId] = useState(() => localStorage.getItem('twoLoonies_jobId') || null);
  
  // 2. Richer state to power your dynamic progress pill
  const [uploadState, setUploadState] = useState({
    active: !!jobId, // If we found an ID on load, we are active
    message: 'Restoring upload session...',
    current: 0,
    total: 0,
    isError: false
  });

  // Use a ref to hold callbacks so the polling loop can access them 
  // even if the component that started the upload unmounts.
  const callbacksRef = useRef({ onSuccess: null, onError: null });
  const skippedDuplicatesRef = useRef([]);

  const startUpload = async (uploadPromise, { onSuccess, onError } = {}) => {
    // 1. Wipe any old jobs from memory before we start
    localStorage.removeItem('twoLoonies_jobId');
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

      // 2. The Bulletproof ID check (Handles both Fetch and Axios!)
      const actualJobId = response?.job_id || response?.data?.job_id;

      if (actualJobId) {
        setJobId(actualJobId); // This triggers the polling loop with the NEW id
      } else if (response && (response.error || response?.data?.error)) {
        throw new Error(response.error || response.data.error);
      } else {
        // Fallback
        onSuccess?.(response);
        setUploadState({ active: false, isError: false });
      }
    } catch (err) {
      handleError(err, 'Failed to start upload.');
    }
  };

  const handleError = (err, fallbackMessage) => {
    console.error("Upload Error:", err);
    callbacksRef.current.onError?.(err);
    setUploadState(prev => ({ ...prev, active: true, isError: true, message: err.message || fallbackMessage }));
    
    // Auto-hide the error pill after 4 seconds
    setTimeout(() => {
      setJobId(null);
      setUploadState(prev => ({ ...prev, active: false }));
    }, 4000);
  };

  // 3. The Polling Loop
  useEffect(() => {
    if (!jobId) {
      localStorage.removeItem('twoLoonies_jobId');
      return;
    }

    // Save to local storage to survive refreshes
    localStorage.setItem('twoLoonies_jobId', jobId);
    let pollInterval;

    const checkStatus = async () => {
      try {
        // Fetch lightweight status
        const statusRes = await fetch(`/api/upload_statement_status/${jobId}`);
        if (!statusRes.ok) throw new Error('Upload session expired or lost.');
        
        const data = await statusRes.json();

        // Update the UI Pill
        setUploadState(prev => ({
          ...prev,
          active: true,
          message: data.message || 'Processing...',
          current: data.current_file || 0,
          total: data.total_files || 0
        }));

        // If complete, fetch the final heavy payload
        if (data.status === 'complete') {
          clearInterval(pollInterval);
          
          const resultRes = await fetch(`/api/upload_statement_result/${jobId}`);
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

          // Keep the success message visible briefly for good UX
          setUploadState(prev => ({ ...prev, message: data.message || 'All done!', isError: false }));
          setTimeout(() => {
            setJobId(null);
            setUploadState(prev => ({ ...prev, active: false }));
          }, 2500); 
        } 
        
        // Handle explicit backend errors
        if (data.status === 'error') {
          throw new Error(data.message || 'Processing failed on the server.');
        }

      } catch (err) {
        clearInterval(pollInterval);
        handleError(err, 'Lost connection to processing server.');
      }
    };

    // Start polling every 750ms
    pollInterval = setInterval(checkStatus, 750);
    checkStatus(); // Fire immediately once before the first 750ms tick

    return () => clearInterval(pollInterval);
  }, [jobId]);

  // Expose the new state shape and the start function
  const value = { 
    uploadInProgress: uploadState.active, 
    startUpload,
    uploadState 
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
          <span className="upload-indicator-label">
            {uploadState.message}
          </span>
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