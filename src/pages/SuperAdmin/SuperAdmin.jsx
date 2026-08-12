import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCases } from '../../context/CaseContext';
import { useSystem } from '../../context/SystemContext';
import { adminAPI, strikesAPI } from '../../utils/api';
import { 
  Shield, Users, Activity, LogOut, DollarSign, Search, Ban, CheckCircle, 
  MessageSquare, Terminal, Download, LayoutDashboard, FileText, Settings, 
  UserPlus, Pencil, Trash2, RotateCcw, AlertTriangle, X, ChevronDown,
  TrendingUp, Package, Clock, Zap, Filter, Eye, CreditCard, RefreshCw
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import CaseRecords from './CaseRecords';
import styles from './SuperAdmin.module.css';

// ─── Confirmation Modal Component ─────────────────────────────────
const ConfirmDialog = ({ title, message, onConfirm, onCancel, danger }) => (
  <div className={styles.modalOverlay}>
    <div className={styles.confirmModal}>
      <div className={styles.confirmIcon} data-danger={danger}>
        <AlertTriangle size={28} />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      <div className={styles.confirmActions}>
        <button className={styles.btnCancel} onClick={onCancel}>Cancel</button>
        <button className={danger ? styles.btnDanger : styles.btnPrimary} onClick={onConfirm}>
          {danger ? 'Confirm Delete' : 'Confirm'}
        </button>
      </div>
    </div>
  </div>
);

// ─── Chart color palette ──────────────────────────────────────────
const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const STATE_CODE_REGISTRY = [
  { code: 'AP', name: 'Andhra Pradesh' }, { code: 'AR', name: 'Arunachal Pradesh' },
  { code: 'AS', name: 'Assam' }, { code: 'BR', name: 'Bihar' },
  { code: 'CG', name: 'Chhattisgarh' }, { code: 'GA', name: 'Goa' },
  { code: 'GJ', name: 'Gujarat' }, { code: 'HR', name: 'Haryana' },
  { code: 'HP', name: 'Himachal Pradesh' }, { code: 'JH', name: 'Jharkhand' },
  { code: 'KA', name: 'Karnataka' }, { code: 'KL', name: 'Kerala' },
  { code: 'MP', name: 'Madhya Pradesh' }, { code: 'MH', name: 'Maharashtra' },
  { code: 'MN', name: 'Manipur' }, { code: 'ML', name: 'Meghalaya' },
  { code: 'MZ', name: 'Mizoram' }, { code: 'NL', name: 'Nagaland' },
  { code: 'OD', name: 'Odisha' }, { code: 'PB', name: 'Punjab' },
  { code: 'RJ', name: 'Rajasthan' }, { code: 'SK', name: 'Sikkim' },
  { code: 'TN', name: 'Tamil Nadu' }, { code: 'TS', name: 'Telangana' },
  { code: 'TR', name: 'Tripura' }, { code: 'UK', name: 'Uttarakhand' },
  { code: 'UP', name: 'Uttar Pradesh' }, { code: 'WB', name: 'West Bengal' },
  { code: 'AN', name: 'Andaman & Nicobar' }, { code: 'CH', name: 'Chandigarh' },
  { code: 'DD', name: 'Dadra & Nagar Haveli' }, { code: 'DL', name: 'Delhi' },
  { code: 'JK', name: 'Jammu & Kashmir' }, { code: 'LA', name: 'Ladakh' },
  { code: 'LD', name: 'Lakshadweep' }, { code: 'PY', name: 'Puducherry' }
];

// ─── Custom Tooltip ───────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, prefix = '' }) => {
  if (active && payload && payload.length) {
    return (
      <div className={styles.customTooltip}>
        <p className={styles.tooltipLabel}>{label}</p>
        <p className={styles.tooltipValue}>
          {prefix}{payload[0].value.toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
};

const SuperAdmin = () => {
  const { user, accounts, toggleAccountStatus, createAccount, updateAccount, deleteAccount, resetPassword, logout, getAccountsByRole } = useAuth();
  const { cases, invoices, assignCase, updateCaseStatus, markInvoicePaid, deleteInvoice, getRevenueByClinic, getCasesByStatus, getCasesByClinic, CASE_PRICING } = useCases();
  const { auditLogs, triggerBroadcast, clearBroadcast, logAudit, clearAuditLogs, exportAuditLogs, getAuditStats } = useSystem();
  
  // ─── Navigation State ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview');
  
  // ─── Refetch trigger ─────────────────────────────────────────────
  // Tabs were reloaded by calling setActiveTab('overview') then
  // setActiveTab('wallets') back to back. React batches those, so
  // activeTab never actually changes value and the fetch effect never
  // re-runs — grants and bonuses saved correctly and then appeared not
  // to, because the table still held stale rows.
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTab = () => setRefreshKey(k => k + 1);

  // ─── Credit terms (admin-only) ───────────────────────────────────
  // Setting a credit line moved off the manager's clinic page, and an
  // admin cannot reach /manager/clinics — that route requires exactly
  // the manager role — so the control lives here.
  const [creditClinic, setCreditClinic] = useState(null);
  const [creditMode, setCreditMode]     = useState('net_30');
  const [creditLimit, setCreditLimit]   = useState('50000');
  const [creditMsg, setCreditMsg]       = useState('');
  const [creditBusy, setCreditBusy]     = useState(false);

  const openCreditModal = (clinicUser) => {
    setCreditClinic(clinicUser);
    setCreditMode(clinicUser.billingMode === 'net_30' ? 'net_30' : 'prepaid');
    setCreditLimit(String((clinicUser.creditLimitPaise || 5000000) / 100));
    setCreditMsg('');
  };

  const saveCreditTerms = async () => {
    if (!creditClinic) return;
    setCreditBusy(true);
    setCreditMsg('');
    try {
      const token = sessionStorage.getItem('hesyra_token');
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const res = await fetch(`${base}/api/manager/clinics/${creditClinic.id}/billing`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingMode: creditMode,
          creditLimitPaise: creditMode === 'net_30' ? Math.round(parseFloat(creditLimit || 0) * 100) : 0,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setCreditMsg(d.error || 'Could not update billing terms.'); return; }
      setCreditMsg('✓ Billing terms updated.');
      setTimeout(() => { setCreditClinic(null); refreshTab(); }, 900);
    } catch {
      setCreditMsg('Network error.');
    } finally {
      setCreditBusy(false);
    }
  };

  // ─── IAM State ───────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [newAccount, setNewAccount] = useState({ 
    name: '', email: '', role: 'dentist', clinic: '', password: 'Hesyra@2026',
    stateCode: '', cityCode: '', docSerial: ''
  });
  
  // ─── Broadcast State ─────────────────────────────────────────────
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastError, setBroadcastError] = useState('');
  
  // ─── Audit State ─────────────────────────────────────────────────
  const [auditSearch, setAuditSearch] = useState('');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState('all');
  
  // ─── Case Routing State ──────────────────────────────────────────
  const [caseSearch, setCaseSearch] = useState('');
  const [caseStatusFilter, setCaseStatusFilter] = useState('all');
  
  // ─── Financial State ─────────────────────────────────────────────
  const [invoiceFilter, setInvoiceFilter] = useState('all');
  
  // ─── Payment System Admin State ──────────────────────────────────
  const [adminPayments, setAdminPayments] = useState([]);
  const [adminWallets, setAdminWallets] = useState([]);
  const [adminTickets, setAdminTickets] = useState([]);
  const [tabLoading, setTabLoading] = useState(false);

  // ─── Confirmation State ──────────────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setTabLoading(true);
      try {
        if (activeTab === 'paymentQueue') {
          const queue = await strikesAPI.getOverdueQueue();
          setAdminPayments(queue);
        } else if (activeTab === 'wallets') {
          const wallets = await adminAPI.getWallets();
          setAdminWallets(wallets);
        } else if (activeTab === 'trust') {
          const tickets = await strikesAPI.getResolutionTickets();
          setAdminTickets(tickets);
        }
      } catch (err) {
        console.error(`Failed to fetch data for ${activeTab}:`, err);
      } finally {
        setTabLoading(false);
      }
    };
    if (['paymentQueue', 'wallets', 'trust'].includes(activeTab)) {
      fetchData();
    }
  }, [activeTab, refreshKey]);

  // ═══ Computed Data ═══════════════════════════════════════════════
  const totalRevenue = useMemo(() => invoices.filter(i => i.status === 'paid').reduce((a, b) => a + b.amount, 0), [invoices]);
  const totalOutstanding = useMemo(() => invoices.filter(i => i.status === 'unpaid').reduce((a, b) => a + b.amount, 0), [invoices]);
  const activeUsers = useMemo(() => accounts.filter(a => a.status === 'active').length, [accounts]);
  const activeCases = useMemo(() => cases.filter(c => !['completed', 'archived', 'cancelled'].includes(c.status)).length, [cases]);
  
  const revenueByClinic = useMemo(() => getRevenueByClinic(), [invoices]);
  const casesByStatus = useMemo(() => getCasesByStatus(), [cases]);
  const casesByClinic = useMemo(() => getCasesByClinic(), [cases]);

  // Build real revenue chart from invoice data
  const revenueChartData = useMemo(() => {
    const monthMap = {};
    invoices.filter(i => i.status === 'paid').forEach(inv => {
      // Parse month from date string
      const parts = inv.date.split(' ');
      const monthKey = parts[0] || 'Unknown';
      monthMap[monthKey] = (monthMap[monthKey] || 0) + inv.amount;
    });
    // Also show unpaid as separate
    invoices.filter(i => i.status === 'unpaid').forEach(inv => {
      const parts = inv.date.split(' ');
      const monthKey = parts[0] || 'Unknown';
      if (!monthMap[monthKey]) monthMap[monthKey] = 0;
    });
    return Object.entries(monthMap).map(([name, revenue]) => ({ name, revenue }));
  }, [invoices]);

  // ═══ Filtered Data ═══════════════════════════════════════════════
  const filteredAccounts = useMemo(() => {
    return accounts.filter(a => {
      const q = searchTerm.toLowerCase();
      const matchesSearch = !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'all' || a.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [accounts, searchTerm, roleFilter]);

  const filteredCases = useMemo(() => {
    return cases.filter(c => {
      const q = caseSearch.toLowerCase();
      const matchesSearch = !q || c.id.toLowerCase().includes(q) || c.patient.toLowerCase().includes(q) || (c.clinic || '').toLowerCase().includes(q) || (c.tech || '').toLowerCase().includes(q);
      const matchesStatus = caseStatusFilter === 'all' || c.status === caseStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [cases, caseSearch, caseStatusFilter]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter(i => invoiceFilter === 'all' || i.status === invoiceFilter);
  }, [invoices, invoiceFilter]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      const q = auditSearch.toLowerCase();
      const matchesSearch = !q || log.action.toLowerCase().includes(q) || log.user.toLowerCase().includes(q);
      const matchesCategory = auditCategoryFilter === 'all' || log.category === auditCategoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [auditLogs, auditSearch, auditCategoryFilter]);

  // ═══ Handlers ════════════════════════════════════════════════════
  const handleCreateAccount = (e) => {
    e.preventDefault();
    
    // Add auto-generated username for dentists
    const payload = { ...newAccount };
    if (payload.role === 'dentist' && payload.stateCode && payload.cityCode && payload.docSerial) {
      payload.username = `${payload.stateCode}${payload.cityCode}${payload.docSerial}`;
    }

    const result = createAccount(payload);
    if (!result.success) {
      alert(result.message);
      return;
    }
    logAudit(`Provisioned new ${payload.role} account: ${payload.name} (${payload.email})${payload.username ? ` [${payload.username}]` : ''}`, 'Admin', 'iam');
    setShowAddModal(false);
    setNewAccount({ 
      name: '', email: '', role: 'dentist', clinic: '', password: 'Hesyra@2026',
      stateCode: '', cityCode: '', docSerial: ''
    });
  };

  const handleUpdateAccount = (e) => {
    e.preventDefault();
    const result = updateAccount(editingAccount.id, editingAccount);
    if (!result.success) {
      alert(result.message);
      return;
    }
    logAudit(`Updated account ${editingAccount.id}: ${editingAccount.name}`, 'Admin', 'iam');
    setEditingAccount(null);
  };

  const handleToggleStatus = (account) => {
    const action = account.status === 'active' ? 'Suspend' : 'Restore';
    setConfirmDialog({
      title: `${action} Account Access`,
      message: `${action} system access for ${account.name} (${account.email})? ${account.status === 'active' ? 'They will be locked out immediately.' : 'They will regain full access.'}`,
      danger: account.status === 'active',
      onConfirm: () => {
        const result = toggleAccountStatus(account.id, user?.id);
        if (!result.success) {
          alert(result.message);
        } else {
          logAudit(`${action}ed account access: ${account.name} [${account.id}]`, 'Admin', 'iam');
        }
        setConfirmDialog(null);
      }
    });
  };

  const handleDeleteAccount = (account) => {
    setConfirmDialog({
      title: 'Permanently Delete Account',
      message: `This will permanently remove ${account.name} (${account.email}) from the system. This action cannot be undone.`,
      danger: true,
      onConfirm: () => {
        const result = deleteAccount(account.id, user?.id);
        if (!result.success) {
          alert(result.message);
        } else {
          logAudit(`Permanently deleted account: ${account.name} [${account.id}]`, 'Admin', 'iam');
        }
        setConfirmDialog(null);
      }
    });
  };

  const handleResetPassword = (account) => {
    setConfirmDialog({
      title: 'Reset Account Password',
      message: `Reset ${account.name}'s password to default? They will need to change it on next login.`,
      danger: false,
      onConfirm: () => {
        const result = resetPassword(account.id);
        if (result.success) {
          logAudit(`Reset password for ${account.name} [${account.id}]`, 'Admin', 'iam');
          alert(`Password reset to: ${result.tempPassword}`);
        }
        setConfirmDialog(null);
      }
    });
  };

  const handleTechReassign = (caseId, newTech) => {
    assignCase(caseId, newTech);
    logAudit(`Re-routed case ${caseId} to Technician [${newTech}]`, 'Admin', 'routing');
  };

  const handleStatusOverride = (caseId, newStatus) => {
    setConfirmDialog({
      title: 'Override Case Status',
      message: `Force-update case ${caseId} to ${newStatus.toUpperCase()}? This may affect billing and workflow state.`,
      danger: false,
      onConfirm: () => {
        updateCaseStatus(caseId, newStatus);
        logAudit(`Force-updated ${caseId} status to [${newStatus.toUpperCase()}]`, 'Admin', 'routing');
        setConfirmDialog(null);
      }
    });
  };

  const handleBroadcast = () => {
    setBroadcastError('');
    const result = triggerBroadcast(broadcastText);
    if (!result.success) {
      setBroadcastError(result.message);
      return;
    }
    setBroadcastText('');
  };

  const handleMarkInvoicePaid = (invoice) => {
    const action = invoice.status === 'paid' ? 'unpaid' : 'paid';
    markInvoicePaid(invoice.id);
    logAudit(`Toggled invoice ${invoice.id} to ${action.toUpperCase()} (₹${invoice.amount.toFixed(2)})`, 'Admin', 'financial');
  };

  const handleExportCSV = () => {
    const headers = ['Invoice ID', 'Date', 'Amount', 'Status', 'Clinic', 'Linked Cases'];
    const rows = invoices.map(i => [
      i.id,
      `"${i.date}"`,
      i.amount,
      i.status.toUpperCase(),
      `"${i.clinic || 'Unknown'}"`,
      `"${(i.cases || []).join('; ')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Hesyra_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    logAudit('Exported Financial CSV Ledger', 'Admin', 'financial');
  };

  const handleClearAudit = () => {
    setConfirmDialog({
      title: 'Purge Audit Trail',
      message: 'Clear all audit log entries? A new system event will be created to record this action.',
      danger: true,
      onConfirm: () => {
        clearAuditLogs();
        setConfirmDialog(null);
      }
    });
  };

  const auditStats = useMemo(() => getAuditStats(), [auditLogs]);

  // ═══ Tab Navigation Config ══════════════════════════════════════
  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'routing', label: 'Case Routing', icon: Package },
    { id: 'financials', label: 'Financials', icon: DollarSign },
    { id: 'paymentQueue', label: 'Payment Queue', icon: Clock },
    { id: 'wallets', label: 'Hesyra Wallets', icon: CreditCard },
    { id: 'trust', label: 'Trust & Disputes', icon: Shield },
    { id: 'records', label: 'Case Records', icon: FileText },
    { id: 'system', label: 'System', icon: Settings },
  ];

  // ═══ STATUS OPTIONS ═════════════════════════════════════════════
  const STATUS_OPTIONS = [
    { value: 'submitted', label: 'SUBMITTED' },
    { value: 'action_required', label: 'ACTION REQUIRED' },
    { value: 'designing', label: 'DESIGNING (CAD)' },
    { value: 'pending_approval', label: 'PENDING APPROVAL' },
    { value: 'printing', label: 'PRINTING / MILLING' },
    { value: 'ready_for_dispatch', label: 'READY FOR DISPATCH' },
    { value: 'payment_pending', label: 'PAYMENT PENDING' },
    { value: 'overdue', label: 'OVERDUE' },
    { value: 'shipped', label: 'DISPATCHED' },
    { value: 'completed', label: 'DELIVERED' },
  ];

  const getStatusColor = (status) => {
    const map = {
      submitted: '#60a5fa', action_required: '#f87171', designing: '#fbbf24',
      pending_approval: '#c084fc', printing: '#a78bfa',
      ready_for_dispatch: '#3b82f6', payment_pending: '#60a5fa', overdue: '#ef4444',
      shipped: '#34d399', completed: '#10b981', draft: '#94a3b8', archived: '#64748b', cancelled: '#ef4444'
    };
    return map[status] || '#94a3b8';
  };

  // ═══ RENDER ═════════════════════════════════════════════════════
  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logoCluster}>
          <div className={styles.logoIcon} style={{ background: 'transparent', border: 'none' }}>
            <img src="/logo.png" alt="Hesyra Logo" style={{ height: '36px' }} />
          </div>
          <div>
            <h1 className={styles.title}>Command Center</h1>
            <p className={styles.subtitle}>Super Administrator • {user?.name}</p>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.systemPulse}>
            <span className={styles.pulseDot}></span>
            <span>All Systems Operational</span>
          </div>
          <button className={styles.btnLogout} onClick={logout}><LogOut size={16} /> Logout</button>
        </div>
      </header>

      {/* Main Layout: Sidebar + Content */}
      <div className={styles.mainLayout}>
        {/* Sidebar Navigation */}
        <nav className={styles.sidebar}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`${styles.navItem} ${activeTab === tab.id ? styles.navItemActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={18} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <main className={styles.content}>

          {/* ══════════════════════════════════════════════════════════
              TAB: OVERVIEW
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'overview' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <h2>System Overview</h2>
                <p>Real-time operational intelligence across all subsystems</p>
              </div>

              {/* Stat Cards */}
              <div className={styles.statsGrid}>
                <div className={styles.statCard} onClick={() => setActiveTab('users')}>
                  <div className={styles.statIcon} style={{background: 'rgba(59,130,246,0.15)', color: '#3b82f6'}}>
                    <Users size={22} />
                  </div>
                  <div className={styles.statInfo}>
                    <span className={styles.statLabel}>Active Users</span>
                    <span className={styles.statValue}>{activeUsers}</span>
                  </div>
                  <span className={styles.statBadge}>{accounts.length} total</span>
                </div>

                <div className={styles.statCard} onClick={() => setActiveTab('routing')}>
                  <div className={styles.statIcon} style={{background: 'rgba(251,191,36,0.15)', color: '#fbbf24'}}>
                    <Activity size={22} />
                  </div>
                  <div className={styles.statInfo}>
                    <span className={styles.statLabel}>Active Cases</span>
                    <span className={styles.statValue}>{activeCases}</span>
                  </div>
                  <span className={styles.statBadge}>{cases.length} total</span>
                </div>

                <div className={styles.statCard} onClick={() => setActiveTab('financials')}>
                  <div className={styles.statIcon} style={{background: 'rgba(16,185,129,0.15)', color: '#10b981'}}>
                    <TrendingUp size={22} />
                  </div>
                  <div className={styles.statInfo}>
                    <span className={styles.statLabel}>Revenue (Cleared)</span>
                    <span className={styles.statValue} style={{color: '#a7f3d0'}}>₹{totalRevenue.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                  </div>
                </div>

                <div className={styles.statCard} onClick={() => setActiveTab('financials')}>
                  <div className={styles.statIcon} style={{background: 'rgba(239,68,68,0.15)', color: '#ef4444'}}>
                    <Clock size={22} />
                  </div>
                  <div className={styles.statInfo}>
                    <span className={styles.statLabel}>Outstanding</span>
                    <span className={styles.statValue} style={{color: '#fbbf24'}}>₹{totalOutstanding.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                  </div>
                </div>
              </div>

              {/* Charts Row */}
              <div className={styles.chartsRow}>
                {/* Revenue Chart */}
                <div className={styles.chartCard}>
                  <h3>Revenue by Period</h3>
                  <div className={styles.chartContainer}>
                    {revenueChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={revenueChartData}>
                          <defs>
                            <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(122,156,150,0.1)" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                          <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} tickFormatter={(v) => `₹${v}`} />
                          <Tooltip content={<CustomTooltip prefix="₹" />} cursor={{ stroke: 'rgba(122,156,150,0.2)', strokeWidth: 1 }} />
                          <Area 
                            type="monotone" 
                            dataKey="revenue" 
                            stroke="#10b981" 
                            strokeWidth={3} 
                            fillOpacity={1} 
                            fill="url(#colorRev)" 
                            animationDuration={1500}
                            animationEasing="ease-in-out"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className={styles.chartEmpty}>No revenue data to display</div>
                    )}
                  </div>
                </div>

                {/* Cases by Status */}
                <div className={styles.chartCard}>
                  <h3>Case Distribution</h3>
                  <div className={styles.chartContainer}>
                    {casesByStatus.length > 0 ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={casesByStatus} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(122,156,150,0.1)" />
                          <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                          <YAxis type="category" dataKey="status" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} width={100} 
                            tickFormatter={(v) => v.replace('_', ' ').toUpperCase()} />
                          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(122,156,150,0.2)', borderRadius: '8px', color: '#e2e8f0' }} />
                          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                            {casesByStatus.map((entry, idx) => (
                              <Cell key={entry.status} fill={getStatusColor(entry.status)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className={styles.chartEmpty}>No case data to display</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Activity Feed */}
              <div className={styles.activityCard}>
                <div className={styles.activityHeader}>
                  <h3><Terminal size={18} /> Recent System Activity</h3>
                  <button className={styles.btnGhost} onClick={() => setActiveTab('system')}>View All →</button>
                </div>
                <div className={styles.activityList}>
                  {auditLogs.slice(0, 8).map(log => (
                    <div key={log.id} className={styles.activityItem}>
                      <span className={styles.activityTime}>{log.time}</span>
                      <span className={styles.activityUser}>{log.user}</span>
                      <span className={styles.activityAction}>{log.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB: USER MANAGEMENT
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'users' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <div>
                  <h2>Identity & Access Management</h2>
                  <p>{accounts.length} registered accounts • {activeUsers} active</p>
                </div>
                <button className={styles.btnPrimary} onClick={() => setShowAddModal(true)}>
                  <UserPlus size={16} /> Provision Account
                </button>
              </div>

              {/* Filters */}
              <div className={styles.toolbar}>
                <div className={styles.searchBar}>
                  <Search size={16} />
                  <input type="text" placeholder="Search by name, email, role..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className={styles.filterGroup}>
                  <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className={styles.filterSelect}>
                    <option value="all">All Roles</option>
                    <option value="admin">Admin</option>
                    <option value="dentist">Dentist</option>
                    <option value="tech">Technician</option>
                  </select>
                </div>
              </div>

              {/* Accounts Table */}
              <div className={styles.tableCard}>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Account ID</th>
                        <th>User Details</th>
                        <th>Role</th>
                        <th>Joined</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAccounts.map(account => (
                        <tr key={account.id} className={account.status === 'suspended' ? styles.rowSuspended : ''}>
                          <td className={styles.monoText}>{account.id}</td>
                          <td>
                            <strong>{account.name}</strong>
                            <div className={styles.subText}>
                              {account.email} • {account.clinic || account.location || '—'}
                              {account.username && <span className={styles.identityBadge}>@{account.username}</span>}
                            </div>
                            {account.stateCode && (
                              <div className={styles.geoTag}>
                                {account.stateCode}{account.cityCode} • Serial {account.docSerial}
                              </div>
                            )}
                          </td>
                          <td><span className={`${styles.roleTag} ${styles[`role_${account.role}`]}`}>{account.role.toUpperCase()}</span></td>
                          <td className={styles.subText}>{account.joinDate}</td>
                          <td>
                            <span className={account.status === 'active' ? styles.statusActive : styles.statusSuspended}>
                              {account.status === 'active' ? '● Active' : '● Suspended'}
                            </span>
                          </td>
                          <td>
                            <div className={styles.actionGroup}>
                              <button className={styles.actionBtn} title="Edit" onClick={() => setEditingAccount({...account})}>
                                <Pencil size={14} />
                              </button>
                              <button className={styles.actionBtn} title="Reset Password" onClick={() => handleResetPassword(account)}>
                                <RotateCcw size={14} />
                              </button>
                              {account.status === 'active' ? (
                                <button className={`${styles.actionBtn} ${styles.actionDanger}`} title="Suspend" onClick={() => handleToggleStatus(account)}>
                                  <Ban size={14} />
                                </button>
                              ) : (
                                <button className={`${styles.actionBtn} ${styles.actionSuccess}`} title="Restore" onClick={() => handleToggleStatus(account)}>
                                  <CheckCircle size={14} />
                                </button>
                              )}
                              {account.id !== user?.id && (
                                <button className={`${styles.actionBtn} ${styles.actionDanger}`} title="Delete" onClick={() => handleDeleteAccount(account)}>
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredAccounts.length === 0 && (
                        <tr><td colSpan="6" className={styles.emptyText}>No accounts match your filters.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB: CASE ROUTING
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'routing' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <div>
                  <h2>Case Routing & Oversight</h2>
                  <p>{cases.length} total cases • {activeCases} active in pipeline</p>
                </div>
              </div>

              {/* Filters */}
              <div className={styles.toolbar}>
                <div className={styles.searchBar}>
                  <Search size={16} />
                  <input type="text" placeholder="Search by Case ID, patient, clinic, tech..." value={caseSearch} onChange={e => setCaseSearch(e.target.value)} />
                </div>
                <div className={styles.filterGroup}>
                  <select value={caseStatusFilter} onChange={e => setCaseStatusFilter(e.target.value)} className={styles.filterSelect}>
                    <option value="all">All Statuses</option>
                    {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Cases Table */}
              <div className={styles.tableCard}>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Case ID</th>
                        <th>Patient</th>
                        <th>Clinic</th>
                        <th>Type</th>
                        <th>Assigned Tech</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCases.map(c => (
                        <tr key={c.id}>
                          <td className={styles.monoText}>{c.id}</td>
                          <td>
                            <strong>{c.patient}</strong>
                          </td>
                          <td className={styles.subText}>{c.clinic}</td>
                          <td className={styles.subText}>{c.type}</td>
                          <td>
                            <select 
                              value={c.tech || 'Unassigned'} 
                              onChange={e => handleTechReassign(c.id, e.target.value)} 
                              className={styles.inlineSelect}
                            >
                              <option value="Unassigned">— Unassigned —</option>
                              {accounts.filter(a => a.role === 'tech' && a.status === 'active').map(t => (
                                <option key={t.id} value={t.name}>{t.name}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select 
                              value={c.status} 
                              onChange={e => handleStatusOverride(c.id, e.target.value)}
                              className={styles.statusSelect}
                              style={{color: getStatusColor(c.status)}}
                            >
                              {STATUS_OPTIONS.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                      {filteredCases.length === 0 && (
                        <tr><td colSpan="6" className={styles.emptyText}>No cases match your filters.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB: FINANCIALS
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'financials' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <div>
                  <h2>Financial Command</h2>
                  <p>{invoices.length} invoices • ₹{totalRevenue.toFixed(2)} collected • ₹{totalOutstanding.toFixed(2)} outstanding</p>
                </div>
                <button className={styles.btnOutline} onClick={handleExportCSV}>
                  <Download size={16} /> Export CSV
                </button>
              </div>

              {/* Financial Summary Cards */}
              <div className={styles.finStatsRow}>
                <div className={styles.finStat}>
                  <span className={styles.finStatLabel}>Total Invoices</span>
                  <span className={styles.finStatValue}>{invoices.length}</span>
                </div>
                <div className={styles.finStat}>
                  <span className={styles.finStatLabel}>Paid</span>
                  <span className={styles.finStatValue} style={{color: '#10b981'}}>{invoices.filter(i => i.status === 'paid').length}</span>
                </div>
                <div className={styles.finStat}>
                  <span className={styles.finStatLabel}>Unpaid</span>
                  <span className={styles.finStatValue} style={{color: '#ef4444'}}>{invoices.filter(i => i.status === 'unpaid').length}</span>
                </div>
                <div className={styles.finStat}>
                  <span className={styles.finStatLabel}>Collection Rate</span>
                  <span className={styles.finStatValue} style={{color: '#3b82f6'}}>
                    {invoices.length > 0 ? Math.round((invoices.filter(i => i.status === 'paid').length / invoices.length) * 100) : 0}%
                  </span>
                </div>
              </div>

              {/* Revenue by Clinic */}
              {revenueByClinic.length > 0 && (
                <div className={styles.chartCard} style={{marginBottom: '1.5rem'}}>
                  <h3>Revenue by Clinic</h3>
                  <div className={styles.chartContainer}>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={revenueByClinic}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(122,156,150,0.1)" />
                        <XAxis dataKey="clinic" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} tickFormatter={(v) => `₹${v}`} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(122,156,150,0.2)', borderRadius: '8px', color: '#e2e8f0' }} />
                        <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                          {revenueByClinic.map((_, idx) => (
                            <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Invoice Filters */}
              <div className={styles.toolbar}>
                <div className={styles.filterGroup}>
                  <select value={invoiceFilter} onChange={e => setInvoiceFilter(e.target.value)} className={styles.filterSelect}>
                    <option value="all">All Invoices</option>
                    <option value="paid">Paid Only</option>
                    <option value="unpaid">Unpaid Only</option>
                  </select>
                </div>
              </div>

              {/* Invoice Table */}
              <div className={styles.tableCard}>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Invoice ID</th>
                        <th>Date</th>
                        <th>Clinic</th>
                        <th>Linked Cases</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.map(inv => (
                        <tr key={inv.id}>
                          <td className={styles.monoText}>{inv.id}</td>
                          <td className={styles.subText}>{inv.date}</td>
                          <td><strong>{inv.clinic || 'Unknown'}</strong></td>
                          <td>
                            <div className={styles.caseTags}>
                              {(inv.cases || []).map(cid => (
                                <span key={cid} className={styles.caseTag}>{cid}</span>
                              ))}
                            </div>
                          </td>
                          <td style={{fontWeight: 600, fontSize: '1.05rem', color: inv.status === 'paid' ? '#10b981' : '#ef4444'}}>
                            ₹{inv.amount.toFixed(2)}
                          </td>
                          <td>
                            <span className={inv.status === 'paid' ? styles.statusPaid : styles.statusUnpaid}>
                              {inv.status === 'paid' ? '● Paid' : '● Unpaid'}
                            </span>
                          </td>
                          <td>
                            <div className={styles.actionGroup}>
                              <button 
                                className={`${styles.actionBtn} ${inv.status === 'paid' ? styles.actionWarning : styles.actionSuccess}`}
                                onClick={() => handleMarkInvoicePaid(inv)}
                                title={inv.status === 'paid' ? 'Mark Unpaid' : 'Mark Paid'}
                              >
                                <CreditCard size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredInvoices.length === 0 && (
                        <tr><td colSpan="7" className={styles.emptyText}>No invoices match your filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB: PAYMENT QUEUE
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'paymentQueue' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <h2>Payment Queue</h2>
                <p>Tracking cases pending payment or strictly overdue</p>
                <button className={styles.btnGhost} onClick={() => setActiveTab('paymentQueue')} title="Refresh">
                  <RefreshCw size={16} className={tabLoading ? styles.spin : ''} />
                </button>
              </div>
              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Case ID</th>
                      <th>Patient</th>
                      <th>Clinic</th>
                      <th>Amount</th>
                      <th>Days Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminPayments.map(p => (
                      <tr key={p.caseId}>
                        <td>{p.caseId}</td>
                        <td>{p.patient}</td>
                        <td>{p.clinic}</td>
                        <td>{p.totalAmountINR}</td>
                        <td style={{color: p.daysOutstanding > 0 ? '#ef4444' : '#fbbf24', fontWeight: 600}}>
                          {p.daysOutstanding}
                        </td>
                        <td>
                          <span className={styles.statusBadge} style={{background: getStatusColor(p.status)}}>
                            {STATUS_OPTIONS.find(so => so.value === p.status)?.label || p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {adminPayments.length === 0 && !tabLoading && (
                      <tr><td colSpan="6" className={styles.emptyText}>No overdue cases in the queue.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB: WALLETS
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'wallets' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <h2>Hesyra Wallets</h2>
                <p>Manage all dentist float balances</p>
                <button className={styles.btnGhost} onClick={() => setActiveTab('wallets')} title="Refresh">
                  <RefreshCw size={16} className={tabLoading ? styles.spin : ''} />
                </button>
              </div>
              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Doctor Name</th>
                      <th>Clinic</th>
                      <th>Trust Level</th>
                      <th>Available Balance (INR)</th>
                      <th>Billing terms</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminWallets.map(w => {
                      const isClinic = w.user.role === 'clinic';
                      const net30 = w.user.billingMode === 'net_30';
                      const limit = (w.user.creditLimitPaise || 0) / 100;
                      const owed  = (w.user.outstandingPaise || 0) / 100;
                      return (
                      <tr key={w.id}>
                        <td>{w.user.customId}</td>
                        <td>{w.user.name}</td>
                        <td>{w.user.clinic}</td>
                        <td><span className={styles.statusBadge} style={{background: w.user.trustLevel === 'clean' ? '#10b981' : '#ef4444'}}>{w.user.trustLevel}</span></td>
                        <td style={{fontWeight: 600}}>₹{(w.balancePaise / 100).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td style={{fontSize: '0.78rem'}}>
                          {/* Staff accounts carry wallet rows too, and
                              billing terms mean nothing on them — the
                              server 404s a non-clinic, so do not offer it. */}
                          {!isClinic ? (
                            <span style={{color: 'var(--text-tertiary)'}}>—</span>
                          ) : net30 ? (
                            <span style={{color: '#a78bfa'}}>
                              Net-30 · ₹{owed.toLocaleString('en-IN')} of ₹{limit.toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span style={{color: 'var(--text-tertiary)'}}>Prepaid</span>
                          )}
                        </td>
                        <td style={{display: 'flex', gap: '6px'}}>
                          {isClinic && (
                            <button className={styles.btnGhost} onClick={() => openCreditModal(w.user)}>
                              Credit terms
                            </button>
                          )}
                          <button className={styles.btnGhost} onClick={() => {
                            const amount = prompt('Enter bonus amount to grant (INR):');
                            if (amount && !isNaN(amount)) {
                              adminAPI.grantBonus(w.userId, Math.round(parseFloat(amount) * 100), `Admin override grant for ${amount} INR`).then(refreshTab);
                            }
                          }}>
                            Grant Bonus
                          </button>
                        </td>
                      </tr>
                    );})}
                    {adminWallets.length === 0 && !tabLoading && (
                      <tr><td colSpan="7" className={styles.emptyText}>No active wallets found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── Credit terms modal (admin-only) ─────────────────── */}
          {creditClinic && (
            <div className={styles.modalOverlay} onClick={() => setCreditClinic(null)}>
              <div className={styles.confirmModal} onClick={e => e.stopPropagation()} style={{textAlign: 'left', maxWidth: 440}}>
                <h3 style={{marginBottom: 4}}>Billing terms</h3>
                <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem'}}>
                  {creditClinic.clinic || creditClinic.name} — currently{' '}
                  <strong style={{color: creditClinic.billingMode === 'net_30' ? '#a78bfa' : 'var(--text-secondary)'}}>
                    {creditClinic.billingMode === 'net_30' ? 'Net-30 credit' : 'Prepaid'}
                  </strong>
                </p>

                {['strike_1', 'strike_2', 'suspended', 'banned'].includes(creditClinic.trustLevel) && creditMode === 'net_30' && (
                  <div style={{background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.9rem', fontSize: '0.78rem', color: '#fca5a5'}}>
                    This clinic is <strong>{creditClinic.trustLevel}</strong>. The server refuses credit to accounts with strikes — resolve the account first.
                  </div>
                )}

                <div style={{display: 'flex', gap: '0.5rem', marginBottom: '0.9rem'}}>
                  {[['prepaid', 'Prepaid', 'Pays before dispatch'], ['net_30', 'Net-30 credit', 'Monthly invoice']].map(([id, label, sub]) => (
                    <button key={id} onClick={() => setCreditMode(id)}
                      style={{
                        flex: 1, padding: '0.6rem', borderRadius: 8, cursor: 'pointer',
                        border: `2px solid ${creditMode === id ? '#a78bfa' : 'rgba(255,255,255,0.1)'}`,
                        background: creditMode === id ? 'rgba(167,139,250,0.1)' : 'transparent',
                        color: creditMode === id ? '#a78bfa' : 'var(--text-secondary)',
                        fontSize: '0.8rem', fontWeight: 600,
                      }}>
                      {label}<br /><span style={{fontSize: '0.68rem', fontWeight: 400, color: 'var(--text-tertiary)'}}>{sub}</span>
                    </button>
                  ))}
                </div>

                {creditMode === 'net_30' && (
                  <div style={{marginBottom: '0.9rem'}}>
                    <label style={{fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem'}}>
                      Credit limit (₹) — how much they may owe before new cases are blocked
                    </label>
                    <input type="number" min="5000" step="5000" value={creditLimit}
                      onChange={e => setCreditLimit(e.target.value)}
                      style={{width: '100%', padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary)', boxSizing: 'border-box'}} />
                  </div>
                )}

                {creditMsg && (
                  <div style={{fontSize: '0.8rem', marginBottom: '0.75rem', color: creditMsg.startsWith('✓') ? '#34d399' : '#f87171'}}>
                    {creditMsg}
                  </div>
                )}

                <div style={{display: 'flex', gap: '0.5rem'}}>
                  <button className={styles.btnGhost} style={{flex: 1}} onClick={() => setCreditClinic(null)}>Cancel</button>
                  <button className={styles.btnPrimary} style={{flex: 2}} onClick={saveCreditTerms} disabled={creditBusy}>
                    {creditBusy ? 'Saving…' : creditMode === 'net_30' ? 'Grant Net-30 credit' : 'Set to prepaid'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB: CASE RECORDS — period statement, admin only
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'records' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <h2>Case Records</h2>
                <p>Every case in a period — including cancelled and archived — with the money as it was charged</p>
              </div>
              <CaseRecords />
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB: TRUST & DISPUTES
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'trust' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <h2>Resolution Tickets</h2>
                <p>Manage account suspensions and dispute handling</p>
                <button className={styles.btnGhost} onClick={() => setActiveTab('trust')} title="Refresh">
                  <RefreshCw size={16} className={tabLoading ? styles.spin : ''} />
                </button>
              </div>
              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Doctor Name</th>
                      <th>Strike Count</th>
                      <th>Trust Level</th>
                      <th>Reason</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminTickets.map(t => (
                      <tr key={t.id}>
                        <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                        <td>{t.user.name}</td>
                        <td>{t.user.strikeCount}</td>
                        <td><span className={styles.statusBadge} style={{background: t.user.trustLevel === 'clean' ? '#10b981' : '#ef4444'}}>{t.user.trustLevel}</span></td>
                        <td>{t.reason}</td>
                        <td>
                          {t.status === 'pending' ? (
                            <div style={{display: 'flex', gap: '8px'}}>
                              <button className={styles.btnPrimary} style={{padding: '0.25rem 0.5rem', fontSize: '0.75rem'}} onClick={() => {
                                strikesAPI.updateResolutionTicket(t.id, 'approved', 'Approved by Admin').then(refreshTab);
                              }}>Approve</button>
                              <button className={styles.btnDanger} style={{padding: '0.25rem 0.5rem', fontSize: '0.75rem'}} onClick={() => {
                                strikesAPI.updateResolutionTicket(t.id, 'rejected', 'Rejected by Admin').then(refreshTab);
                              }}>Reject</button>
                            </div>
                          ) : (
                            <span className={styles.statusBadge} style={{background: t.status === 'approved' ? '#10b981' : '#ef4444'}}>
                              {t.status.toUpperCase()}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {adminTickets.length === 0 && !tabLoading && (
                      <tr><td colSpan="6" className={styles.emptyText}>No active resolution tickets.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              TAB: SYSTEM
          ══════════════════════════════════════════════════════════ */}
          {activeTab === 'system' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <h2>System Operations</h2>
                <p>Broadcast engine, security audit trail, and diagnostics</p>
              </div>

              <div className={styles.systemGrid}>
                {/* Broadcast Panel */}
                <div className={styles.systemPanel}>
                  <div className={styles.panelHeader}>
                    <h3><MessageSquare size={18} style={{color: '#3b82f6'}} /> Global Fleet Broadcast</h3>
                  </div>
                  <div className={styles.panelBody}>
                    <p className={styles.panelDesc}>Push an urgent notification banner to all connected Dentist and Technician instances globally.</p>
                    <textarea 
                      value={broadcastText} onChange={e => { setBroadcastText(e.target.value); setBroadcastError(''); }} 
                      placeholder="Type system alert message..." 
                      className={styles.textarea}
                    />
                    {broadcastError && <div className={styles.fieldError}>{broadcastError}</div>}
                    <div className={styles.panelActions}>
                      <button className={styles.btnPrimary} onClick={handleBroadcast}>
                        <Zap size={16} /> Transmit
                      </button>
                      <button className={styles.btnOutline} onClick={clearBroadcast}>
                        Clear Active Alert
                      </button>
                    </div>
                  </div>
                </div>

                {/* Audit Stats */}
                <div className={styles.systemPanel}>
                  <div className={styles.panelHeader}>
                    <h3><Activity size={18} style={{color: '#fbbf24'}} /> Audit Intelligence</h3>
                  </div>
                  <div className={styles.panelBody}>
                    <div className={styles.auditStatsGrid}>
                      <div className={styles.auditStatItem}>
                        <span className={styles.auditStatValue}>{auditStats.total}</span>
                        <span className={styles.auditStatLabel}>Total Events</span>
                      </div>
                      <div className={styles.auditStatItem}>
                        <span className={styles.auditStatValue}>{auditStats.last24h}</span>
                        <span className={styles.auditStatLabel}>Last 24h</span>
                      </div>
                      {Object.entries(auditStats.byCategory).slice(0, 4).map(([cat, count]) => (
                        <div key={cat} className={styles.auditStatItem}>
                          <span className={styles.auditStatValue}>{count}</span>
                          <span className={styles.auditStatLabel}>{cat}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Audit Log Stream */}
              <div className={styles.auditSection}>
                <div className={styles.auditLogHeader}>
                  <h3><Terminal size={18} /> Chronological Audit Stream</h3>
                  <div className={styles.auditActions}>
                    <button className={styles.btnGhost} onClick={exportAuditLogs}><Download size={14} /> Export</button>
                    <button className={`${styles.btnGhost} ${styles.btnGhostDanger}`} onClick={handleClearAudit}><Trash2 size={14} /> Purge</button>
                  </div>
                </div>
                
                {/* Audit Filters */}
                <div className={styles.toolbar} style={{marginBottom: 0, padding: '0 0 1rem'}}>
                  <div className={styles.searchBar}>
                    <Search size={16} />
                    <input type="text" placeholder="Search audit events..." value={auditSearch} onChange={e => setAuditSearch(e.target.value)} />
                  </div>
                  <select value={auditCategoryFilter} onChange={e => setAuditCategoryFilter(e.target.value)} className={styles.filterSelect}>
                    <option value="all">All Categories</option>
                    <option value="iam">IAM</option>
                    <option value="routing">Routing</option>
                    <option value="financial">Financial</option>
                    <option value="broadcast">Broadcast</option>
                    <option value="system">System</option>
                  </select>
                </div>

                <div className={styles.auditTerminal}>
                  {filteredAuditLogs.map(log => (
                    <div key={log.id} className={styles.auditLine}>
                      <span className={styles.auditTimestamp}>[{log.time}]</span>
                      <span className={styles.auditCategory}>{(log.category || 'gen').toUpperCase()}</span>
                      <span className={styles.auditUser}>{log.user}</span>
                      <span className={styles.auditMsg}>{log.action}</span>
                    </div>
                  ))}
                  {filteredAuditLogs.length === 0 && (
                    <div className={styles.auditEmpty}>No events match your filter criteria.</div>
                  )}
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ══════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════ */}
      
      {/* Provision New Account Modal */}
      {showAddModal && (
        <div className={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Provision New Account</h2>
              <button className={styles.modalClose} onClick={() => setShowAddModal(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateAccount} className={styles.modalForm}>
              <div className={styles.formField}>
                <label>Full Name</label>
                <input type="text" required value={newAccount.name} onChange={e => setNewAccount({...newAccount, name: e.target.value})} placeholder="John Doe" />
              </div>
              <div className={styles.formField}>
                <label>Email Address</label>
                <input type="email" required value={newAccount.email} onChange={e => setNewAccount({...newAccount, email: e.target.value})} placeholder="user@clinic.com" />
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Role</label>
                  <select value={newAccount.role} onChange={e => setNewAccount({...newAccount, role: e.target.value})}>
                    <option value="dentist">Dentist</option>
                    <option value="tech">Technician</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>{newAccount.role === 'dentist' ? 'Clinic Name' : 'Department / Location'}</label>
                  <input type="text" required value={newAccount.clinic} onChange={e => setNewAccount({...newAccount, clinic: e.target.value})} placeholder={newAccount.role === 'dentist' ? 'Apex Dental' : 'Lab Floor A'} />
                </div>
              </div>

              {/* Geo-Coding for Dentists */}
              {newAccount.role === 'dentist' && (
                <div className={styles.geoSection}>
                  <div className={styles.sectionLabel}>RTO Geo-Coding (Identity Standard)</div>
                  <div className={styles.formRow}>
                    <div className={styles.formField}>
                      <label>State</label>
                      <select required value={newAccount.stateCode} onChange={e => setNewAccount({...newAccount, stateCode: e.target.value})}>
                        <option value="">— Select —</option>
                        {STATE_CODE_REGISTRY.map(s => (
                          <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.formField}>
                      <label>City Code</label>
                      <input type="text" maxLength="2" placeholder="01-99" required value={newAccount.cityCode} onChange={e => setNewAccount({...newAccount, cityCode: e.target.value.replace(/\D/g, '')})} />
                    </div>
                    <div className={styles.formField}>
                      <label>Serial #</label>
                      <input type="text" maxLength="2" placeholder="1-9" required value={newAccount.docSerial} onChange={e => setNewAccount({...newAccount, docSerial: e.target.value.replace(/\D/g, '')})} />
                    </div>
                  </div>
                  <div className={styles.usernamePreview}>
                    Generated ID: <span>{newAccount.stateCode || '??'}{newAccount.cityCode || '??'}{newAccount.docSerial || '?'}</span>
                  </div>
                </div>
              )}

              <div className={styles.formField}>
                <label>Temporary Password</label>
                <input type="text" required value={newAccount.password} onChange={e => setNewAccount({...newAccount, password: e.target.value})} className={styles.monoInput} />
                <span className={styles.formHint}>User can change this in their personal settings.</span>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className={styles.btnPrimary}>Create Account</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div className={styles.modalOverlay} onClick={() => setEditingAccount(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Edit Account — {editingAccount.id}</h2>
              <button className={styles.modalClose} onClick={() => setEditingAccount(null)}><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateAccount} className={styles.modalForm}>
              <div className={styles.formField}>
                <label>Full Name</label>
                <input type="text" required value={editingAccount.name} onChange={e => setEditingAccount({...editingAccount, name: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Email Address</label>
                <input type="email" required value={editingAccount.email} onChange={e => setEditingAccount({...editingAccount, email: e.target.value})} />
              </div>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label>Role</label>
                  <select value={editingAccount.role} onChange={e => setEditingAccount({...editingAccount, role: e.target.value})}>
                    <option value="dentist">Dentist</option>
                    <option value="tech">Technician</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>{editingAccount.role === 'dentist' ? 'Clinic' : 'Location'}</label>
                  <input type="text" value={editingAccount.clinic || editingAccount.location || ''} 
                    onChange={e => setEditingAccount({...editingAccount, clinic: e.target.value, location: e.target.value})} />
                </div>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setEditingAccount(null)}>Cancel</button>
                <button type="submit" className={styles.btnPrimary}>Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialog 
          title={confirmDialog.title}
          message={confirmDialog.message}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

    </div>
  );
};

export default SuperAdmin;
