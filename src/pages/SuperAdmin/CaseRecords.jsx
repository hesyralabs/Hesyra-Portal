import React, { useState, useEffect, useCallback } from 'react';
import { Download, Mail, RefreshCw, FileSpreadsheet } from 'lucide-react';
import styles from './CaseRecords.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const PRESETS = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7',     label: 'Last 7 days' },
  { id: 'last30',    label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'custom',    label: 'Custom' },
];

// Local calendar date — toISOString() would hand back yesterday for the
// whole IST morning, which is the wrong default for a date picker.
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const money = (n) =>
  '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCell = (value, type) => {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'datetime') {
    return new Date(value).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit',
    });
  }
  if (type === 'money') return (value).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  return String(value);
};

const CaseRecords = () => {
  const [preset, setPreset] = useState('last7');
  const [from, setFrom]     = useState(todayISO());
  const [to, setTo]         = useState(todayISO());

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [notice, setNotice]   = useState('');
  const [busy, setBusy]       = useState('');

  const token = sessionStorage.getItem('hesyra_token');

  const queryString = useCallback(() => {
    const p = new URLSearchParams({ preset });
    if (preset === 'custom') { p.set('from', from); p.set('to', to); }
    return p.toString();
  }, [preset, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API}/api/records/cases?${queryString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not build the statement.'); setData(null); return; }
      setData(d);
    } catch {
      setError('Could not reach the server.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString, token]);

  useEffect(() => { load(); }, [load]);

  // The download needs an Authorization header, so it cannot be a plain
  // link — fetch it, then hand the browser a blob.
  const download = async () => {
    setBusy('download');
    setError('');
    try {
      const res = await fetch(`${API}/api/records/cases.xlsx?${queryString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'The spreadsheet could not be generated.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data?.filename || 'hesyra-cases.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${data?.filename || 'the statement'}.`);
    } catch {
      setError('The download failed.');
    } finally {
      setBusy('');
    }
  };

  const emailToMe = async () => {
    setBusy('email');
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API}/api/records/cases/email?${queryString()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (!res.ok) { setError(d.hint ? `${d.error} ${d.hint}` : (d.error || 'The email could not be sent.')); return; }
      setNotice(`Sent to ${d.sentTo} — ${d.caseCount} cases attached as ${d.filename}.`);
    } catch {
      setError('The email could not be sent.');
    } finally {
      setBusy('');
    }
  };

  const s = data?.summary;

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.presets} role="tablist">
          {PRESETS.map(p => (
            <button key={p.id} role="tab" aria-selected={preset === p.id}
              className={`${styles.preset} ${preset === p.id ? styles.presetOn : ''}`}
              onClick={() => setPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className={styles.dates}>
            <input type="date" className={styles.dateInput} value={from} max={todayISO()}
              onChange={e => setFrom(e.target.value)} aria-label="From date" />
            <span className={styles.dateSep}>to</span>
            <input type="date" className={styles.dateInput} value={to} max={todayISO()}
              onChange={e => setTo(e.target.value)} aria-label="To date" />
          </div>
        )}

        <span className={styles.spacer} />

        <div className={styles.actions}>
          <button className={styles.btn} onClick={load} disabled={loading} title="Refresh">
            <RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button className={styles.btn} onClick={emailToMe}
            disabled={!data || busy === 'email' || !data.mailAvailable}
            title={data && !data.mailAvailable
              ? 'No mail transport is configured on this server — set SMTP_HOST, SMTP_PORT and SMTP_FROM in server/.env'
              : 'Email this statement to your own address'}>
            <Mail size={14} /> {busy === 'email' ? 'Sending…' : 'Email to me'}
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={download}
            disabled={!data || busy === 'download'}>
            <Download size={14} /> {busy === 'download' ? 'Building…' : 'Download .xlsx'}
          </button>
        </div>
      </div>

      {error && <div className={`${styles.msg} ${styles.msgError}`}>{error}</div>}
      {notice && <div className={`${styles.msg} ${styles.msgOk}`}>{notice}</div>}

      {/* Said once, plainly, rather than letting the button look broken. */}
      {data && !data.mailAvailable && !error && (
        <div className={`${styles.msg} ${styles.msgInfo}`}>
          Emailing is switched off because this server has no mail transport configured.
          Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code> and <code>SMTP_FROM</code> in
          {' '}<code>server/.env</code> and restart to enable it. Download works either way.
        </div>
      )}

      {s && (
        <div className={styles.summary}>
          <div className={styles.tile}><span className={styles.tileVal}>{s.caseCount}</span><span className={styles.tileLabel}>Cases</span></div>
          <div className={styles.tile}><span className={styles.tileVal}>{s.unitCount}</span><span className={styles.tileLabel}>Units</span></div>
          <div className={styles.tile}><span className={`${styles.tileVal} ${styles.tileMoney}`}>{money(s.netTotal)}</span><span className={styles.tileLabel}>Net</span></div>
          <div className={styles.tile}><span className={styles.tileVal}>{money(s.gstTotal)}</span><span className={styles.tileLabel}>GST</span></div>
          <div className={styles.tile}><span className={`${styles.tileVal} ${styles.tileMoney}`}>{money(s.grandTotal)}</span><span className={styles.tileLabel}>Total</span></div>
          <div className={styles.tile}><span className={styles.tileVal}>{money(s.paidTotal)}</span><span className={styles.tileLabel}>Collected</span></div>
          <div className={styles.tile}><span className={`${styles.tileVal} ${styles.tileWarn}`}>{money(s.unpaidTotal)}</span><span className={styles.tileLabel}>Outstanding</span></div>
        </div>
      )}

      <div className={styles.sheetWrap}>
        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>
            <FileSpreadsheet size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {data?.range?.label || 'Case statement'}
          </span>
          <span className={styles.sheetMeta}>
            {data ? `${data.rows.length} row${data.rows.length === 1 ? '' : 's'} · ${data.columns.length} columns · every status included` : ''}
          </span>
        </div>

        <div className={styles.scroll}>
          {loading ? (
            <div className={styles.empty}>Building the statement…</div>
          ) : !data || data.rows.length === 0 ? (
            <div className={styles.empty}>
              No cases were created in this period.
              <span className={styles.emptyHint}>
                The range filters on when a case was created, not when it shipped.
              </span>
            </div>
          ) : (
            <table className={styles.sheet}>
              <thead>
                <tr>{data.columns.map(c => <th key={c.key}>{c.header}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.customId || i}>
                    {data.columns.map(c => (
                      <td key={c.key}
                        className={`${c.type === 'money' || c.type === 'number' ? styles.num : ''} ${!row[c.key] && row[c.key] !== 0 ? styles.muted : ''}`}>
                        {fmtCell(row[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default CaseRecords;
