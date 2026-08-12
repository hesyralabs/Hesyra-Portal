// ═══════════════════════════════════════════════════════════════════
// Centralized API Client for Hesyra Portal
// All HTTP requests to the backend flow through this module.
// ═══════════════════════════════════════════════════════════════════

const API_BASE = '/api';

let authToken = null;

/**
 * Set the JWT token for all subsequent requests
 */
export function setAuthToken(token) {
  authToken = token;
}

/**
 * Clear the auth token (on logout)
 */
export function clearAuthToken() {
  authToken = null;
}

/**
 * Get the current auth token
 */
export function getAuthToken() {
  return authToken;
}

/**
 * Core fetch wrapper with JWT, error handling, and JSON parsing
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Extract data early to read specific server errors
    let data = {};
    try {
      data = await response.json();
    } catch (e) {
      // Ignore JSON parse errors for empty responses
    }

    // Handle 401 — token expired or invalid login
    if (response.status === 401) {
      clearAuthToken();
      // Throw the server's specific error if provided, else fallback
      throw new Error(data.error || data.message || 'Authentication expired. Please log in again.');
    }

    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (${response.status})`);
    }

    return data;
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('Server unavailable. Please check your connection.');
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════
// AUTH API
// ═══════════════════════════════════════════════════════════════════
export const authAPI = {
  login: (email, password) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  me: () => apiFetch('/auth/me'),

  changePassword: (oldPassword, newPassword) =>
    apiFetch('/auth/password', { method: 'PUT', body: JSON.stringify({ oldPassword, newPassword }) }),

  completeOnboarding: (data) =>
    apiFetch('/auth/onboarding', { method: 'PUT', body: JSON.stringify(data) }),

  updateOnboardingState: (data) =>
    apiFetch('/auth/onboarding-state', { method: 'PATCH', body: JSON.stringify(data) }),

  updateProfile: (data) =>
    apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify(data) }),
};

// ═══════════════════════════════════════════════════════════════════
// CASES API
// ═══════════════════════════════════════════════════════════════════
export const casesAPI = {
  list: () => apiFetch('/cases'),

  get: (customId) => apiFetch(`/cases/${customId}`),

  create: (caseData) =>
    apiFetch('/cases', { method: 'POST', body: JSON.stringify(caseData) }),

  updateStatus: (customId, statusData) =>
    apiFetch(`/cases/${customId}/status`, { method: 'PUT', body: JSON.stringify(statusData) }),

  update: (customId, data) =>
    apiFetch(`/cases/${customId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Ordering doctor's clinical sign-off on a CAD design.
  // action: 'approve' | 'revise'
  designApproval: (customId, action, reason) =>
    apiFetch(`/cases/${customId}/design-approval`, {
      method: 'PUT',
      body: JSON.stringify({ action, reason }),
    }),

  addMessage: (customId, text, from) =>
    apiFetch(`/cases/${customId}/messages`, { method: 'POST', body: JSON.stringify({ text, from }) }),

  delete: (customId) =>
    apiFetch(`/cases/${customId}`, { method: 'DELETE' }),

  // File upload — uses FormData (multipart), NOT JSON
  uploadFile: async (customId, files, category = 'design') => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    formData.append('category', category);

    const response = await fetch(`${API_BASE}/cases/${customId}/upload`, {
      method: 'POST',
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        // NOTE: Do NOT set Content-Type — browser sets it with boundary for FormData
      },
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Upload failed');
    }

    return response.json();
  },

  deleteFile: (customId, fileId) =>
    apiFetch(`/cases/${customId}/files/${fileId}`, { method: 'DELETE' }),
};

// ═══════════════════════════════════════════════════════════════════
// INVOICES API
// ═══════════════════════════════════════════════════════════════════
export const invoicesAPI = {
  list: () => apiFetch('/invoices'),

  togglePaid: (customId) =>
    apiFetch(`/invoices/${customId}`, { method: 'PUT' }),

  delete: (customId) =>
    apiFetch(`/invoices/${customId}`, { method: 'DELETE' }),
};

// ═══════════════════════════════════════════════════════════════════
// PAYMENT API
// ═══════════════════════════════════════════════════════════════════
export const paymentAPI = {
  getStatus: (caseCustomId) =>
    apiFetch(`/payment/status/${caseCustomId}`),

  createLink: (caseCustomId) =>
    apiFetch(`/payment/create-link/${caseCustomId}`, { method: 'POST' }),

  simulatePayment: (caseCustomId) =>
    apiFetch(`/payment/simulate/${caseCustomId}`, { method: 'POST' }),

  raiseDispute: (caseCustomId, reason) =>
    apiFetch(`/payment/dispute/${caseCustomId}`, { method: 'POST', body: JSON.stringify({ reason }) }),

  resolveDispute: (caseCustomId, resolution) =>
    apiFetch(`/payment/resolve-dispute/${caseCustomId}`, { method: 'POST', body: JSON.stringify({ resolution }) }),
};

// ═══════════════════════════════════════════════════════════════════
// WALLET API
// ═══════════════════════════════════════════════════════════════════
export const walletAPI = {
  getBalance: () => apiFetch('/wallet'),

  getLedger: (page = 1) => apiFetch(`/wallet/ledger?page=${page}`),

  reload: (amountPaise) =>
    apiFetch('/wallet/reload', { method: 'POST', body: JSON.stringify({ amountPaise }) }),

  simulateReload: (amountPaise) =>
    apiFetch('/wallet/simulate-reload', { method: 'POST', body: JSON.stringify({ amountPaise }) }),

  setPreferredMode: (mode) =>
    apiFetch('/wallet/set-preferred-mode', { method: 'POST', body: JSON.stringify({ mode }) }),
};

// ═══════════════════════════════════════════════════════════════════
// STRIKES API
// ═══════════════════════════════════════════════════════════════════
export const strikesAPI = {
  getMyStatus: () => apiFetch('/strikes/my-status'),

  getAccountStrikes: (userId) => apiFetch(`/strikes/account/${userId}`),

  pardonStrike: (strikeId, reason) =>
    apiFetch(`/strikes/pardon/${strikeId}`, { method: 'POST', body: JSON.stringify({ reason }) }),

  submitResolutionTicket: (reason) =>
    apiFetch('/strikes/resolution-ticket', { method: 'POST', body: JSON.stringify({ reason }) }),

  getResolutionTickets: () => apiFetch('/strikes/resolution-tickets'),

  updateResolutionTicket: (id, status, adminNotes) =>
    apiFetch(`/strikes/resolution-tickets/${id}`, { method: 'PUT', body: JSON.stringify({ status, adminNotes }) }),

  getOverdueQueue: () => apiFetch('/strikes/overdue-queue'),
};

// ═══════════════════════════════════════════════════════════════════
// SCAN DAY API
// Launch offer: a scanner visit opens a 7-day window in which crown
// orders earn complimentary crowns. Credits are a redeemable
// entitlement against a future crown, never wallet money.
// ═══════════════════════════════════════════════════════════════════
export const scanDayAPI = {
  // Clinic: unredeemed crowns + progress inside any open window.
  myCredits: () => apiFetch('/scan-day/my-credits'),

  // Lab staff: visit log.
  listVisits: () => apiFetch('/scan-day/visits'),

  logVisit: (data) =>
    apiFetch('/scan-day/visits', { method: 'POST', body: JSON.stringify(data) }),
};

// ═══════════════════════════════════════════════════════════════════
// ADMIN API
// ═══════════════════════════════════════════════════════════════════
export const adminAPI = {
  // Accounts
  listAccounts: () => apiFetch('/admin/accounts'),
  createAccount: (data) =>
    apiFetch('/admin/accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateAccount: (id, data) =>
    apiFetch(`/admin/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleAccountStatus: (id) =>
    apiFetch(`/admin/accounts/${id}/toggle-status`, { method: 'PUT' }),
  resetPassword: (id) =>
    apiFetch(`/admin/accounts/${id}/reset-password`, { method: 'PUT' }),
  deleteAccount: (id) =>
    apiFetch(`/admin/accounts/${id}`, { method: 'DELETE' }),

  // Broadcast
  getBroadcast: () => apiFetch('/admin/broadcast'),
  triggerBroadcast: (message) =>
    apiFetch('/admin/broadcast', { method: 'POST', body: JSON.stringify({ message }) }),
  clearBroadcast: () =>
    apiFetch('/admin/broadcast', { method: 'DELETE' }),

  // Audit
  getAuditLogs: () => apiFetch('/admin/audit'),
  logAudit: (action, user, category) =>
    apiFetch('/admin/audit', { method: 'POST', body: JSON.stringify({ action, user, category }) }),
  clearAuditLogs: () =>
    apiFetch('/admin/audit', { method: 'DELETE' }),

  // Financials (Payments & Wallets)
  getPayments: () => apiFetch('/admin/payments'),
  confirmPayment: (caseId, reason) =>
    apiFetch(`/admin/payments/${caseId}/manual-confirm`, { method: 'PUT', body: JSON.stringify({ reason }) }),
  getWallets: () => apiFetch('/admin/wallets'),
  grantBonus: (userId, amountPaise, reason) =>
    apiFetch(`/admin/wallets/${userId}/bonus`, { method: 'POST', body: JSON.stringify({ amountPaise, reason }) }),
};
