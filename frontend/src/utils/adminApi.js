/**
 * Lightweight admin API helper.
 * All requests include the Supabase JWT as Bearer token.
 */
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_BASE || '';

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Config
export const getAdminConfig = (token) =>
  axios.get(`${API_BASE}/api/admin/config`, { headers: authHeader(token) });

export const updateAdminConfig = (key, value, token) =>
  axios.patch(`${API_BASE}/api/admin/config/${key}`, { value }, { headers: authHeader(token) });

// Prompts
export const getAdminPrompts = (token) =>
  axios.get(`${API_BASE}/api/admin/prompts`, { headers: authHeader(token) });

export const createAdminPrompt = (data, token) =>
  axios.post(`${API_BASE}/api/admin/prompts`, data, { headers: authHeader(token) });

export const activateAdminPrompt = (id, token) =>
  axios.patch(`${API_BASE}/api/admin/prompts/${id}/activate`, {}, { headers: authHeader(token) });

export const deleteAdminPrompt = (id, token) =>
  axios.delete(`${API_BASE}/api/admin/prompts/${id}`, { headers: authHeader(token) });

// Users
export const getAdminUsers = (params, token) =>
  axios.get(`${API_BASE}/api/admin/users`, { params, headers: authHeader(token) });

export const getAdminUser = (userId, token) =>
  axios.get(`${API_BASE}/api/admin/users/${userId}`, { headers: authHeader(token) });

export const hardDeleteUser = (userId, token) =>
  axios.delete(`${API_BASE}/api/admin/users/${userId}/hard-delete`, { headers: authHeader(token) });

// Audit log
export const getAuditLog = (params, token) =>
  axios.get(`${API_BASE}/api/admin/audit-log`, { params, headers: authHeader(token) });

// API keys
export const getApiKeyStatus = (token) =>
  axios.get(`${API_BASE}/api/admin/api-key-status`, { headers: authHeader(token) });

// Analytics
export const getExtractionSummary = (period, token) =>
  axios.get(`${API_BASE}/api/admin/analytics/extraction-summary`, { params: { period }, headers: authHeader(token) });

export const getConfidenceDistribution = (period, token) =>
  axios.get(`${API_BASE}/api/admin/analytics/confidence-distribution`, { params: { period }, headers: authHeader(token) });

export const getUploadVolume = (period, token) =>
  axios.get(`${API_BASE}/api/admin/analytics/upload-volume`, { params: { period }, headers: authHeader(token) });

export const getActiveUsers = (period, token) =>
  axios.get(`${API_BASE}/api/admin/analytics/active-users`, { params: { period }, headers: authHeader(token) });

export const getErrorRates = (period, token) =>
  axios.get(`${API_BASE}/api/admin/analytics/error-rates`, { params: { period }, headers: authHeader(token) });

export const getQueueHealth = (token) =>
  axios.get(`${API_BASE}/api/admin/queue-health`, { headers: authHeader(token) });
