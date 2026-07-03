import React, { useState } from 'react';
import { Search, Filter, Calendar, ChevronRight, PackageCheck, Archive as ArchiveIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import styles from './Archive.module.css';

const Archive = () => {
  const { cases } = useCases();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filter for completed/shipped/archived cases matching user's clinic
  const archivedCases = cases.filter(c => c.clinic === user?.clinic && ['shipped', 'Shipped', 'completed', 'Completed', 'archived'].includes(c.status));
  
  // Apply search
  const filteredCases = archivedCases.filter(c => 
    c.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.patient.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getTypeLabel = (type) => {
    switch(type) {
      case 'crown_bridge': return 'Crowns & Bridges';
      case 'surgical_guide': return 'Surgical Guide';
      case 'aligner': return 'Aligners';
      case 'splint': return 'Splint / Guard';
      case 'retainer': return 'Retainer';
      default: return type.replace('_', ' ');
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}><ArchiveIcon size={28} className={styles.titleIcon} /> Case Archive</h1>
          <p className={styles.subtitle}>History of all your completed and shipped cases.</p>
        </div>
        
        <div className={styles.controls}>
          <div className={styles.searchBar}>
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Search by ID or Patient..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className={styles.filterBtn}>
            <Filter size={16} /> Filter
          </button>
        </div>
      </header>

      <div className={styles.card}>
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Patient Ref</th>
                <th>Case Type</th>
                <th>Material</th>
                <th>Completion Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan="7" className={styles.emptyState}>
                    <PackageCheck size={32} />
                    <p>No archived cases found matching your criteria.</p>
                  </td>
                </tr>
              ) : (
                filteredCases.map(c => (
                  <tr key={c.id} onClick={() => navigate(`/case/${c.id}`)} className={styles.tableRow}>
                    <td className={styles.idCell}>
                      <strong>{c.id}</strong>
                    </td>
                    <td>{c.patient}</td>
                    <td>
                      <span className={styles.typeTag}>{getTypeLabel(c.type)}</span>
                    </td>
                    <td className={styles.materialCell}>{c.material}</td>
                    <td className={styles.dateCell}>
                      <Calendar size={14} /> Oct 24, 2024
                    </td>
                    <td>
                      <span className={styles.statusBadge}>
                        {c.status}
                      </span>
                    </td>
                    <td className={styles.actionCell}>
                      <ChevronRight size={18} />
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

export default Archive;
