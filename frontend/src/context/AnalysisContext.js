import React, { createContext, useContext, useState, useCallback } from 'react';

const AnalysisContext = createContext(null);

export function AnalysisProvider({ children }) {
  const [analysis, setAnalysis] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [source, setSource] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [itemId, setItemId] = useState(null);
  const [files, setFiles] = useState([]);

  const setAnalysisData = useCallback((data) => {
    setAnalysis(data?.analysis || null);
    setTransactions(data?.transactions || []);
    setSource(data?.source || null);
    setAccessToken(data?.access_token || null);
    setItemId(data?.item_id || null);
    setFiles(data?.files || []);
  }, []);

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setTransactions([]);
    setSource(null);
    setAccessToken(null);
    setItemId(null);
    setFiles([]);
  }, []);

  return (
    <AnalysisContext.Provider
      value={{
        analysis,
        transactions,
        source,
        accessToken,
        itemId,
        files,
        setAnalysisData,
        clearAnalysis,
      }}
    >
      {children}
    </AnalysisContext.Provider>
  );
}

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis must be used within AnalysisProvider');
  return ctx;
}
