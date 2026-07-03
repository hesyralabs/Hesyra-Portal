import React, { useState } from 'react';
import { Search, Filter, MoreVertical, Download, MonitorPlay } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCases } from '../../context/CaseContext';
import styles from './LabAdmin.module.css';

const STATUS_OPTIONS = ['draft', 'submitted', 'action_required', 'pending_approval', 'designing', 'printing', 'shipped', 'completed', 'archived', 'cancelled'];

const getStatusBadge = (status) => {
  switch (status) {
    case 'submitted': return <span className={`${styles.badge} ${styles.badgeSubmitted}`}>Submitted</span>;
    case 'designing': return <span className={`${styles.badge} ${styles.badgeDesigning}`}>Designing</span>;
    case 'printing': return <span className={`${styles.badge} ${styles.badgePrinting}`}>Printing/QC</span>;
    case 'shipped': return <span className={`${styles.badge} ${styles.badgeShipped}`}>Shipped</span>;
    case 'archived': return <span className={`${styles.badge}`} style={{background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)'}}>Archived</span>;
    case 'cancelled': return <span className={`${styles.badge}`} style={{background: 'rgba(255,0,0,0.1)', color: '#ef4444'}}>Cancelled</span>;
    default: return <span className={`${styles.badge} ${styles.badgeDraft}`}>{status.replace('_', ' ')}</span>;
  }
};

const LabAdmin = () => {
  const { cases, updateCaseStatus } = useCases();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingCase, setEditingCase] = useState(null);

  const filteredCases = cases.filter(c => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = !q || 
      c.id.toLowerCase().includes(q) ||
      c.patient.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q) ||
      (c.clinic || '').toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleStatusChange = (caseId, newStatus) => {
    updateCaseStatus(caseId, newStatus);
    setEditingCase(null);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Master Production Board</h1>
          <p className={styles.subtitle}>Lab Management View • {cases.length} total cases • {filteredCases.length} shown</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnOutline}><Download size={16} /> Export CSV</button>
          <Link to="/" className={styles.btnPrimary}><MonitorPlay size={16} /> Dentist View</Link>
        </div>
      </header>

      <div className={styles.tableControls}>
        <div className={styles.searchBar}>
          <Search size={16} className={styles.searchIcon} />
          <input type="text" placeholder="Search by Case ID, Patient, Clinic..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className={styles.filters}>
          <select className={styles.filterSelect} value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="submitted">Submitted</option>
            <option value="designing">Designing</option>
            <option value="printing">Printing</option>
            <option value="shipped">Shipped</option>
          </select>
        </div>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Patient</th>
                <th>Rx Type</th>
                <th>Received</th>
                <th>Status</th>
                <th>Assigned Tech</th>
                <th className={styles.textRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCases.length === 0 ? (
                <tr><td colSpan="7" className={styles.emptyRow}>No cases match your search.</td></tr>
              ) : (
                filteredCases.map((c) => (
                  <tr key={c.id}>
                    <td className={styles.fontMono}>
                      <Link to={`/case/${c.id}`} className={styles.caseLink}>{c.id}</Link>
                    </td>
                    <td className={styles.primaryText}>{c.patient}</td>
                    <td>
                      <div className={styles.primaryText}>{c.type}</div>
                    </td>
                    <td className={styles.secondaryText}>{c.received}</td>
                    <td>
                      {editingCase === c.id ? (
                        <select className={styles.statusSelect} value={c.status}
                          onChange={(e) => handleStatusChange(c.id, e.target.value)}
                          onBlur={() => setEditingCase(null)} autoFocus>
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span onClick={() => setEditingCase(c.id)} style={{cursor: 'pointer'}} title="Click to change status">
                          {getStatusBadge(c.status)}
                        </span>
                      )}
                    </td>
                    <td>
                      {c.tech === 'Unassigned' ? (
                        <span className={styles.unassignedText}>Unassigned</span>
                      ) : (
                        <span className={styles.techText}>{c.tech}</span>
                      )}
                    </td>
                    <td className={styles.textRight}>
                      <Link to={`/case/${c.id}`} className={styles.actionBtn} title="View Case">
                        <MoreVertical size={16} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LabAdmin;
