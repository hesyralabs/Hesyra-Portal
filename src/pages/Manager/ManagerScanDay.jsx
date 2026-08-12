import React, { useState, useEffect, useCallback } from 'react';
import { ScanLine, Plus, X, ChevronDown, ChevronRight, Gift } from 'lucide-react';
import styles from './ManagerScanDay.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Mirrors REWARD_TIERS in server/lib/scanDay.js. The server is the
// authority — this only draws the progress bar.
const REWARD_TIERS = [
  { orders: 5,  crowns: 1 },
  { orders: 20, crowns: 5 },
];

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });

// Days left in a window, floored at 0.
const daysLeft = (until) =>
  Math.max(0, Math.ceil((new Date(until) - Date.now()) / 86400000));

// Local calendar date, not UTC. toISOString() would hand back yesterday
// for the whole IST morning, which silently opens the window a day early.
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ManagerScanDay = () => {
  const [visits, setVisits]   = useState([]);
  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTerms, setShowTerms] = useState(false);

  // Log-a-visit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [clinicId, setClinicId]   = useState('');
  const [visitedAt, setVisitedAt] = useState(todayISO());
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [okMsg, setOkMsg]         = useState('');

  const token = sessionStorage.getItem('hesyra_token');

  const fetchVisits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/scan-day/visits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setVisits(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [token]);

  const fetchClinics = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/manager/clinics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setClinics(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
  }, [token]);

  useEffect(() => { fetchVisits(); fetchClinics(); }, [fetchVisits, fetchClinics]);

  const openModal = () => {
    setClinicId('');
    setVisitedAt(todayISO());
    setNotes('');
    setError('');
    setOkMsg('');
    setModalOpen(true);
  };

  const logVisit = async () => {
    if (!clinicId) { setError('Choose which clinic was visited.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/scan-day/visits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: clinicId, visitedAt, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 409 carries a human sentence naming the clinic and its open window.
        setError(data.error || 'Could not log the visit.');
        return;
      }
      setOkMsg(`Window open until ${fmtDate(data.visit.qualifiesUntil)}.`);
      await fetchVisits();
      setTimeout(() => setModalOpen(false), 1100);
    } catch {
      setError('Network error — the visit was not logged.');
    } finally {
      setSaving(false);
    }
  };

  const openVisits    = visits.filter(v => v.open);
  const crownsIssued  = visits.reduce((n, v) => n + (v.creditsIssued || 0), 0);
  const crownsRedeemed= visits.reduce((n, v) => n + (v.creditsRedeemed || 0), 0);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}><ScanLine size={22} /> Scan Day</h1>
          <p className={styles.subtitle}>
            Scanner visits and the complimentary crowns they have earned
          </p>
        </div>
        <button className={styles.logBtn} onClick={openModal}>
          <Plus size={15} /> Log a scan visit
        </button>
      </header>

      {/* The offer's own terms, one click away rather than always on screen. */}
      <div className={styles.terms}>
        <button className={styles.termsToggle} onClick={() => setShowTerms(s => !s)}>
          {showTerms ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          How the launch offer works
        </button>
        {showTerms && (
          <div className={styles.termsBody}>
            Logging a visit opens a <strong>7-day qualifying window</strong> for that clinic.<br />
            <strong>5 crown orders</strong> in the window → <strong>+1 crown free</strong>.
            <strong> 20 crown orders</strong> → <strong>+5 free</strong> (both tiers stack).<br />
            Crowns are issued in the clinic's most-ordered tier and expire 90 days after
            they are earned. Complimentary crowns never count towards earning more.
            Not exchangeable for cash or credit.
          </div>
        )}
      </div>

      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statVal}>{openVisits.length}</span>
          <span className={styles.statLabel}>Open windows</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{visits.length}</span>
          <span className={styles.statLabel}>Visits logged</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{crownsIssued}</span>
          <span className={styles.statLabel}>Crowns earned</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{crownsRedeemed}</span>
          <span className={styles.statLabel}>Crowns redeemed</span>
        </div>
      </div>

      <div className={styles.table}>
        <div className={styles.tableHeader}>
          <span>Clinic</span>
          <span>Visited</span>
          <span>Window</span>
          <span>Crown orders</span>
          <span>Complimentary</span>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading scan visits…</div>
        ) : visits.length === 0 ? (
          <div className={styles.empty}>
            No scan visits logged yet.
            <span className={styles.emptyHint}>
              Log one when the scanner goes out to a clinic — that is what opens their qualifying window.
            </span>
          </div>
        ) : visits.map(v => {
          const count = v.crownOrderCount || 0;
          const next  = REWARD_TIERS.find(t => count < t.orders);
          const pct   = next
            ? Math.round((count / next.orders) * 100)
            : 100;

          return (
            <div key={v.id} className={`${styles.tableRow} ${v.open ? '' : styles.closed}`}>
              <div className={styles.clinicCell}>
                <span className={styles.clinicName} title={v.notes || undefined}>{v.clinic}</span>
                <span className={styles.visitId}>{v.id}</span>
              </div>

              <span className={styles.dateCell}>{fmtDate(v.visitedAt)}</span>

              <span>
                {v.open ? (
                  <span className={styles.windowOpen}>
                    {daysLeft(v.qualifiesUntil)}d left
                  </span>
                ) : (
                  <span className={styles.windowClosed}>Closed</span>
                )}
              </span>

              <div className={styles.progressCell}>
                <div className={styles.progressTop}>
                  <span className={styles.progressCount}>{count}</span>
                  <span>{next ? `${next.orders} → +${next.crowns} free` : 'all tiers earned'}</span>
                </div>
                <div className={styles.progressBar}>
                  <div
                    className={`${styles.progressFill} ${next ? '' : styles.progressMaxed}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className={styles.creditsCell}>
                {v.creditsIssued > 0 ? (
                  <>
                    <span className={styles.creditsIssued}>
                      <Gift size={11} /> {v.creditsIssued} crown{v.creditsIssued > 1 ? 's' : ''}
                    </span>
                    <span className={styles.creditsRedeemed}>
                      {v.creditsRedeemed} redeemed
                    </span>
                  </>
                ) : (
                  <span className={styles.creditsNone}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className={styles.modalOverlay} onClick={() => setModalOpen(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setModalOpen(false)}>
              <X size={18} />
            </button>
            <h2 className={styles.modalTitle}>Log a scan visit</h2>
            <p className={styles.modalSub}>
              This opens a seven-day window from the visit date. Crown orders the clinic
              places inside it count towards their complimentary crowns.
            </p>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="sd-clinic">Clinic visited</label>
              <select
                id="sd-clinic"
                className={styles.select}
                value={clinicId}
                onChange={e => setClinicId(e.target.value)}
              >
                <option value="">Select a clinic…</option>
                {clinics.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.clinic || c.name}{c.username ? ` · ${c.username}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="sd-date">Visit date</label>
              <input
                id="sd-date"
                type="date"
                className={styles.input}
                value={visitedAt}
                max={todayISO()}
                onChange={e => setVisitedAt(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="sd-notes">Notes <span style={{ opacity: 0.6 }}>(optional)</span></label>
              <textarea
                id="sd-notes"
                className={styles.textarea}
                value={notes}
                placeholder="Who went, what was scanned, anything to follow up"
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            {error && <div className={styles.msgError}>{error}</div>}
            {okMsg && <div className={styles.msgOk}>✓ Visit logged. {okMsg}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={() => setModalOpen(false)}>Cancel</button>
              <button className={styles.btnSave} onClick={logVisit} disabled={saving}>
                {saving ? 'Logging…' : 'Log visit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerScanDay;
