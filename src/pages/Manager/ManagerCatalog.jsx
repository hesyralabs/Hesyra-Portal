import React, { useState, useEffect, useCallback } from 'react';
import { Package, ToggleLeft, ToggleRight, Edit3, Plus, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import styles from './ManagerCatalog.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const CASE_TYPE_LABELS = {
  crown_bridge: 'Crown & Bridge', veneer: 'Veneer', denture: 'Denture',
  surgical_guide: 'Surgical Guide', splint: 'Splint', retainer: 'Retainer',
  aligner: 'Aligner',
};

const ManagerCatalog = () => {
  const { user } = useAuth();
  const token = sessionStorage.getItem('hesyra_token');
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // slug being edited or 'new'

  const isAdmin = user?.role === 'admin';

  const fetchMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/catalog/materials/all`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMaterials(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchMaterials(); }, [fetchMaterials]);

  const toggleActive = async (slug, currentActive) => {
    try {
      await fetch(`${API}/api/catalog/materials/${slug}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentActive }),
      });
      fetchMaterials();
    } catch (err) { console.error(err); }
  };

  const saveStockNote = async (slug, note) => {
    try {
      await fetch(`${API}/api/catalog/materials/${slug}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockNote: note }),
      });
      fetchMaterials();
    } catch (err) { console.error(err); }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}><Package size={22} /> Material Catalog</h1>
          <p className={styles.subtitle}>
            {isAdmin ? 'Full catalog control — pricing, naming, and stock.' : 'Manage material stock availability. Pricing is admin-only.'}
          </p>
        </div>
      </header>

      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statVal}>{materials.filter(m => m.active).length}</span>
          <span className={styles.statLabel}>Active</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{materials.filter(m => !m.active).length}</span>
          <span className={styles.statLabel}>Inactive</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{materials.filter(m => m.stockNote).length}</span>
          <span className={styles.statLabel}>Stock Notes</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{materials.length}</span>
          <span className={styles.statLabel}>Total SKUs</span>
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading catalog...</div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Material</span>
            <span>Internal Name</span>
            <span>Case Types</span>
            <span>Category</span>
            <span>Shade</span>
            <span>Finishing</span>
            <span>Price</span>
            <span>Stock</span>
            <span>Active</span>
          </div>

          {materials.map(m => {
            const tiers = Array.isArray(m.finishingTiers) ? m.finishingTiers : JSON.parse(m.finishingTiers || '[]');
            const types = Array.isArray(m.caseTypes) ? m.caseTypes : JSON.parse(m.caseTypes || '[]');
            return (
              <div key={m.slug} className={`${styles.tableRow} ${!m.active ? styles.inactive : ''}`}>
                <span className={styles.materialName}>
                  {m.displayName}
                </span>
                <span className={styles.internalName}>{m.internalName || '—'}</span>
                <span className={styles.caseTypes}>
                  {types.map(t => (
                    <span key={t} className={styles.typeBadge}>{CASE_TYPE_LABELS[t] || t}</span>
                  ))}
                </span>
                <span className={styles.category}>{m.category}</span>
                <span>{m.shadeApplicable ? '✓' : '—'}</span>
                <span>
                  {tiers.includes('premium') ? (
                    <span className={styles.premiumBadge}>✨ Signature</span>
                  ) : (
                    <span className={styles.standardBadge}>Studio</span>
                  )}
                </span>
                <span className={styles.price}>
                  {isAdmin ? (
                    <>{m.basePrice ? `₹${(m.basePrice / 100).toLocaleString()}` : '—'}{m.premiumUpcharge ? <span className={styles.upcharge}> +₹{(m.premiumUpcharge / 100).toLocaleString()}</span> : ''}</>
                  ) : (
                    <span style={{color:'var(--text-tertiary)', fontSize:'0.7rem'}}>Admin only</span>
                  )}
                </span>
                <span>
                  {m.stockNote ? (
                    <span className={styles.stockWarning} title={m.stockNote}>
                      <AlertTriangle size={12} /> {m.stockNote.slice(0, 20)}
                    </span>
                  ) : (
                    <span className={styles.stockOk}>In Stock</span>
                  )}
                  <button className={styles.noteBtn} onClick={() => {
                    const note = window.prompt('Stock note (empty to clear):', m.stockNote || '');
                    if (note !== null) saveStockNote(m.slug, note || null);
                  }}>
                    <Edit3 size={12} />
                  </button>
                </span>
                <span>
                  <button className={styles.toggleBtn} onClick={() => toggleActive(m.slug, m.active)}>
                    {m.active ? <ToggleRight size={24} className={styles.toggleOn} /> : <ToggleLeft size={24} className={styles.toggleOff} />}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ManagerCatalog;
