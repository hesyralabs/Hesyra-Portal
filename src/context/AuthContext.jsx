import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authAPI, adminAPI, setAuthToken, clearAuthToken } from '../utils/api';
import { useToasts } from './ToastContext';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const { addToast } = useToasts();
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // ─── On mount: try to restore session from stored token ─────
  useEffect(() => {
    const storedToken = sessionStorage.getItem('hesyra_token');
    if (storedToken) {
      setAuthToken(storedToken);
      authAPI.me()
        .then(userData => {
          setUser({ ...userData, initials: userData.name.substring(0, 2).toUpperCase() });
        })
        .catch(() => {
          sessionStorage.removeItem('hesyra_token');
          clearAuthToken();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // ─── Load accounts (admin feature) ─────────────────────────
  const loadAccounts = useCallback(async () => {
    try {
      const data = await adminAPI.listAccounts();
      setAccounts(data);
    } catch {
      // Non-admin users will get 403 — that's fine
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadAccounts();
    }
  }, [user, loadAccounts]);

  // ─── Login ──────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    try {
      const data = await authAPI.login(email, password);
      if (data.success) {
        setAuthToken(data.token);
        sessionStorage.setItem('hesyra_token', data.token);
        setUser(data.user);
        
        const welcomeKey = `hesyra_welcomed_${data.user.id}`;
        if (!localStorage.getItem(welcomeKey)) {
          addToast(`Welcome to the Hesyra portal, ${data.user.name}!`, 'success');
          localStorage.setItem(welcomeKey, 'true');
        }
        
        return { success: true, user: data.user };
      }
      addToast(data.message || 'Login failed', 'error');
      return { success: false, message: data.message || 'Login failed' };
    } catch (err) {
      addToast(err.message || 'Login failed', 'error');
      return { success: false, message: err.message || 'Login failed' };
    }
  }, [addToast]);

  // ─── Logout ─────────────────────────────────────────────────
  const logout = useCallback(() => {
    setUser(null);
    setAccounts([]);
    clearAuthToken();
    sessionStorage.removeItem('hesyra_token');
    addToast('You have been logged out.', 'info');
  }, [addToast]);

  // ─── Account Management (Admin) ─────────────────────────────
  const toggleAccountStatus = useCallback(async (id, currentUserId) => {
    if (id === currentUserId) {
      addToast('Cannot modify your own account status.', 'warning');
      return { success: false, message: 'Cannot modify your own account status.' };
    }
    try {
      const result = await adminAPI.toggleAccountStatus(id);
      if (result.success) {
        setAccounts(prev => prev.map(a =>
          a.id === id ? { ...a, status: result.status } : a
        ));
        addToast(`Account status updated to ${result.status}.`, 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message, 'error');
      return { success: false, message: err.message };
    }
  }, [addToast]);

  const createAccount = useCallback(async (accountData) => {
    try {
      const result = await adminAPI.createAccount(accountData);
      if (result.success) {
        setAccounts(prev => [...prev, result.account]);
        addToast(`Account created for ${accountData.name}.`, 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message, 'error');
      return { success: false, message: err.message };
    }
  }, [addToast]);

  const updateAccount = useCallback(async (id, updates) => {
    try {
      const result = await adminAPI.updateAccount(id, updates);
      if (result.success) {
        setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
        addToast('Account information updated.', 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message, 'error');
      return { success: false, message: err.message };
    }
  }, [addToast]);

  const deleteAccount = useCallback(async (id, currentUserId) => {
    if (id === currentUserId) {
      addToast('Cannot delete your own account.', 'warning');
      return { success: false, message: 'Cannot delete your own account.' };
    }
    try {
      const result = await adminAPI.deleteAccount(id);
      if (result.success) {
        setAccounts(prev => prev.filter(a => a.id !== id));
        addToast('Account permanently deleted.', 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message, 'error');
      return { success: false, message: err.message };
    }
  }, [addToast]);

  const changePassword = useCallback(async (email, oldPassword, newPassword) => {
    try {
      const result = await authAPI.changePassword(oldPassword, newPassword);
      if (result.success) {
        addToast('Password changed successfully.', 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message, 'error');
      return { success: false, message: err.message };
    }
  }, [addToast]);

  // ─── First-Time Onboarding ──────────────────────────────────
  const completeOnboarding = useCallback(async (formData) => {
    try {
      const result = await authAPI.completeOnboarding(formData);
      if (result.success) {
        setUser(result.user);
        addToast(`Welcome aboard, ${result.user.name}! Your profile is all set.`, 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message, 'error');
      return { success: false, message: err.message };
    }
  }, [addToast]);

  const updateProfile = useCallback(async (formData) => {
    try {
      const result = await authAPI.updateProfile(formData);
      if (result.success) {
        setUser(result.user);
        addToast('Profile updated successfully.', 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message, 'error');
      return { success: false, message: err.message };
    }
  }, [addToast]);

  const resetPassword = useCallback(async (id) => {
    try {
      const result = await adminAPI.resetPassword(id);
      if (result.success) {
        addToast('Password has been reset to default.', 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message, 'error');
      return { success: false, message: err.message };
    }
  }, [addToast]);

  // ─── Analytics helpers ──────────────────────────────────────
  const getAccountsByRole = useCallback(() => {
    const map = {};
    accounts.forEach(a => {
      map[a.role] = (map[a.role] || 0) + 1;
    });
    return map;
  }, [accounts]);

  // Show loading state while checking auth
  if (loading) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100vh', background: '#0a0a0f', color: '#94a3b8',
        fontFamily: 'Inter, sans-serif', fontSize: '1rem',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚙️</div>
          Initializing Hesyra Portal...
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{
      user, accounts,
      toggleAccountStatus, createAccount, updateAccount, deleteAccount,
      changePassword, resetPassword, login, logout, completeOnboarding, updateProfile,
      isAuthenticated: !!user,
      getAccountsByRole,
      loadAccounts,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
