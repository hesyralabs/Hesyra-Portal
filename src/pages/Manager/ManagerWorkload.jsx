import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, User, Package, Zap, RefreshCw } from 'lucide-react';
import styles from './ManagerWorkload.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const ManagerWorkload = () => {
  const [workload, setWorkload] = useState([]);
  const [designers, setDesigners] = useState([]);
  const [loading, setLoading] = useState(true);

  const token = sessionStorage.getItem('hesyra_token');
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, dRes] = await Promise.all([
        fetch(`${API}/api/manager/workload`, { headers }),
        fetch(`${API}/api/manager/designers`, { headers }),
      ]);
      setWorkload(await wRes.json());
      setDesigners(await dRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const maxCases = Math.max(...workload.map(t => t.activeCases), 1);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Team Workload</h1>
          <p className={styles.subtitle}>Live assignment load across technicians and CAD designers</p>
        </div>
        <button className={styles.refreshBtn} onClick={fetchData}><RefreshCw size={15} /></button>
      </header>

      <div className={styles.grid}>
        {/* ─── Technician Workload ─── */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <User size={16} />
            <span>Lab Technicians</span>
            <span className={styles.panelCount}>{workload.length}</span>
          </div>
          {loading ? (
            <div className={styles.loadingMsg}>Loading…</div>
          ) : workload.length === 0 ? (
            <div className={styles.emptyMsg}>No active technicians</div>
          ) : (
            <div className={styles.memberList}>
              {workload.map(tech => (
                <div key={tech.id} className={styles.memberCard}>
                  <div className={styles.memberMeta}>
                    <div className={styles.memberAvatar}>{tech.name.substring(0, 2).toUpperCase()}</div>
                    <div>
                      <div className={styles.memberName}>{tech.name}</div>
                      <div className={styles.memberId}>@{tech.username}</div>
                    </div>
                    {tech.priorityCases > 0 && (
                      <span className={styles.priorityBadge}>⚡ {tech.priorityCases} urgent</span>
                    )}
                    <span className={styles.caseCount}>{tech.activeCases} cases</span>
                  </div>
                  <div className={styles.barTrack}>
                    <div
                      className={styles.barFill}
                      style={{
                        width: `${(tech.activeCases / maxCases) * 100}%`,
                        background: tech.activeCases > 5
                          ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                          : tech.activeCases > 3
                            ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                            : 'linear-gradient(90deg, #10b981, #059669)',
                      }}
                    />
                  </div>
                  {tech.cases.slice(0, 3).map(c => (
                    <div key={c.customId} className={styles.miniCase}>
                      <span className={styles.miniId}>{c.customId}</span>
                      <span className={styles.miniStatus}>{c.status}</span>
                      {c.priorityFlag && <span className={styles.miniPriority}>⚡</span>}
                    </div>
                  ))}
                  {tech.cases.length > 3 && (
                    <div className={styles.moreCase}>+{tech.cases.length - 3} more</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── CAD Designer Workload ─── */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <Zap size={16} />
            <span>CAD Designers</span>
            <span className={styles.panelCount}>{designers.length}</span>
          </div>
          {loading ? (
            <div className={styles.loadingMsg}>Loading…</div>
          ) : designers.length === 0 ? (
            <div className={styles.emptyMsg}>No active CAD designers</div>
          ) : (
            <div className={styles.memberList}>
              {designers.map(d => {
                const lastSeen = d.lastActiveAt
                  ? new Date(d.lastActiveAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                  : 'Never';
                return (
                  <div key={d.id} className={styles.memberCard}>
                    <div className={styles.memberMeta}>
                      <div className={`${styles.memberAvatar} ${styles.cadAvatar}`}>{d.name.substring(0, 2).toUpperCase()}</div>
                      <div>
                        <div className={styles.memberName}>{d.name}</div>
                        <div className={styles.memberId}>Last seen: {lastSeen}</div>
                      </div>
                      <span className={styles.caseCount}>{d.activeCases} cases</span>
                    </div>
                    {d.designerCases?.slice(0, 3).map(c => (
                      <div key={c.customId} className={styles.miniCase}>
                        <span className={styles.miniId}>{c.customId}</span>
                        <span className={styles.miniStatus}>{c.status}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ManagerWorkload;
