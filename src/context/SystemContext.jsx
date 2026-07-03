import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { adminAPI } from '../utils/api';

const SystemContext = createContext(null);

export const SystemProvider = ({ children }) => {
  const [broadcast, setBroadcast] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);

  // ─── Load initial data from API ───────────────────────────
  useEffect(() => {
    // Try to load broadcast (may fail if not admin — that's fine)
    adminAPI.getBroadcast()
      .then(data => { if (data) setBroadcast(data); })
      .catch(() => {});

    adminAPI.getAuditLogs()
      .then(data => setAuditLogs(data))
      .catch(() => {});
  }, []);

  // ─── Socket.io real-time broadcast sync ────────────────────
  useEffect(() => {
    const socket = window.__hesyraSocket;
    if (socket) {
      socket.on('broadcast:new', (data) => setBroadcast(data));
      socket.on('broadcast:clear', () => setBroadcast(null));
      socket.on('audit:new', (entry) => {
        setAuditLogs(prev => [entry, ...prev].slice(0, 500));
      });
    }
    return () => {
      if (socket) {
        socket.off('broadcast:new');
        socket.off('broadcast:clear');
        socket.off('audit:new');
      }
    };
  }, []);

  const triggerBroadcast = useCallback(async (message) => {
    if (!message || !message.trim()) {
      return { success: false, message: 'Broadcast message cannot be empty.' };
    }
    try {
      const result = await adminAPI.triggerBroadcast(message);
      if (result.success) {
        const payload = { id: Date.now(), text: message.trim(), active: true, timestamp: new Date().toISOString() };
        setBroadcast(payload);
        await logAudit('Triggered Global System Broadcast', 'Admin', 'broadcast');
      }
      return result;
    } catch (err) {
      return { success: false, message: err.message };
    }
  }, []);

  const clearBroadcast = useCallback(async () => {
    try {
      await adminAPI.clearBroadcast();
      setBroadcast(null);
      await logAudit('Cleared Global System Broadcast', 'Admin', 'broadcast');
    } catch (err) {
      console.error('Clear broadcast failed:', err);
    }
  }, []);

  const logAudit = useCallback(async (action, user, category = 'general') => {
    try {
      await adminAPI.logAudit(action, user, category);
      const newEntry = {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        action, user, category,
      };
      setAuditLogs(prev => [newEntry, ...prev].slice(0, 500));
    } catch {
      // Non-critical, may fail for non-admin users
    }
  }, []);

  const clearAuditLogs = useCallback(async () => {
    try {
      await adminAPI.clearAuditLogs();
      const clearedEntry = {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        action: 'Audit log cleared by administrator',
        user: 'SYSTEM', category: 'system',
      };
      setAuditLogs([clearedEntry]);
    } catch (err) {
      console.error('Clear audit logs failed:', err);
    }
  }, []);

  const exportAuditLogs = useCallback(() => {
    const headers = ['Timestamp', 'Date', 'User', 'Category', 'Action'];
    const rows = auditLogs.map(log => [
      `"${log.time}"`, `"${log.date || 'N/A'}"`, `"${log.user}"`,
      `"${log.category || 'general'}"`, `"${log.action}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Hesyra_AuditLog_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    logAudit('Exported audit log to CSV', 'Admin', 'system');
  }, [auditLogs, logAudit]);

  const getAuditStats = useCallback(() => {
    const last24h = Date.now() - (24 * 60 * 60 * 1000);
    const recentLogs = auditLogs.filter(l => l.id > last24h);
    const byCategory = {};
    auditLogs.forEach(l => {
      const cat = l.category || 'general';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    return { total: auditLogs.length, last24h: recentLogs.length, byCategory };
  }, [auditLogs]);

  return (
    <SystemContext.Provider value={{
      broadcast, triggerBroadcast, clearBroadcast,
      auditLogs, logAudit, clearAuditLogs, exportAuditLogs, getAuditStats,
    }}>
      {children}
    </SystemContext.Provider>
  );
};

export const useSystem = () => useContext(SystemContext);
