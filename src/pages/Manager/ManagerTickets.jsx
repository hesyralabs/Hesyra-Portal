import React, { useState, useEffect, useCallback } from 'react';
import { Ticket, RefreshCw, MessageSquare, ChevronsUp, CheckCircle } from 'lucide-react';
import styles from './ManagerTickets.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', color: '#ef4444' },
  high:   { label: 'High',   color: '#f59e0b' },
  normal: { label: 'Normal', color: '#60a5fa' },
  low:    { label: 'Low',    color: '#94a3b8' },
};

const STATUS_CONFIG = {
  open:        { label: 'Open',        color: '#60a5fa' },
  in_progress: { label: 'In Progress', color: '#f59e0b' },
  escalated:   { label: 'Escalated',   color: '#ef4444' },
  resolved:    { label: 'Resolved',    color: '#10b981' },
  closed:      { label: 'Closed',      color: '#64748b' },
};

const ManagerTickets = () => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('open');
  const [activeTicket, setActiveTicket] = useState(null);
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);

  const token = sessionStorage.getItem('hesyra_token');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const res = await fetch(`${API}/api/manager/tickets${params}`, { headers });
      setTickets(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const updateTicket = async (id, data) => {
    setSaving(true);
    await fetch(`${API}/api/manager/tickets/${id}`, {
      method: 'PUT', headers,
      body: JSON.stringify(data),
    });
    setSaving(false);
    setActiveTicket(null);
    fetchTickets();
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Support Tickets</h1>
          <p className={styles.subtitle}>Respond, escalate, or resolve clinic support requests</p>
        </div>
        <div className={styles.controls}>
          {['open', 'in_progress', 'escalated', 'resolved', 'all'].map(s => (
            <button
              key={s}
              className={`${styles.filterBtn} ${statusFilter === s ? styles.filterActive : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
            </button>
          ))}
          <button className={styles.refreshBtn} onClick={fetchTickets}><RefreshCw size={14} /></button>
        </div>
      </header>

      <div className={styles.ticketList}>
        {loading ? (
          <div className={styles.loadingMsg}>Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <div className={styles.emptyMsg}>
            <Ticket size={40} />
            <p>No {statusFilter !== 'all' ? statusFilter : ''} tickets</p>
          </div>
        ) : (
          tickets.map(t => {
            const pCfg = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.normal;
            const sCfg = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
            return (
              <div
                key={t.id}
                className={`${styles.ticketCard} ${activeTicket?.id === t.id ? styles.ticketExpanded : ''}`}
              >
                <div className={styles.ticketHead} onClick={() => setActiveTicket(activeTicket?.id === t.id ? null : t)}>
                  <div className={styles.ticketLeft}>
                    <span className={styles.priorityDot} style={{ background: pCfg.color }} />
                    <div>
                      <div className={styles.ticketSubject}>{t.subject}</div>
                      <div className={styles.ticketMeta}>
                        {t.user?.name} · {t.case?.customId || 'No case'} ·{' '}
                        {new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                  </div>
                  <div className={styles.ticketRight}>
                    <span className={styles.statusBadge} style={{ color: sCfg.color, borderColor: `${sCfg.color}33` }}>
                      {sCfg.label}
                    </span>
                    <span className={styles.priorityBadge} style={{ color: pCfg.color }}>
                      {pCfg.label}
                    </span>
                  </div>
                </div>

                {activeTicket?.id === t.id && (
                  <div className={styles.ticketBody}>
                    <p className={styles.ticketDesc}>{t.description}</p>
                    {t.resolution && (
                      <div className={styles.existingResolution}>
                        <strong>Previous resolution:</strong> {t.resolution}
                      </div>
                    )}
                    <textarea
                      className={styles.resolutionInput}
                      placeholder="Type a resolution or response..."
                      value={resolution}
                      onChange={e => setResolution(e.target.value)}
                      rows={3}
                    />
                    <div className={styles.ticketActions}>
                      <button
                        className={styles.escalateBtn}
                        onClick={() => updateTicket(t.id, { escalatedToAdmin: true, resolution })}
                        disabled={saving}
                      >
                        <ChevronsUp size={14} /> Escalate to Admin
                      </button>
                      <button
                        className={styles.resolveBtn}
                        onClick={() => updateTicket(t.id, { status: 'resolved', resolution })}
                        disabled={saving || !resolution.trim()}
                      >
                        <CheckCircle size={14} /> Mark Resolved
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ManagerTickets;
